import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, USER_ROLES, type UserRole } from '../../db/schema/index.js';
import {
  requireRole, hashPin, verifyPin, revokeUserSessions, activeAdminCount, PIN_PATTERN,
} from '../auth/index.js';

// Account admin (ADR 0004). Admins create accounts, set roles, reset PINs and
// deactivate (never delete — names stay on the books). Everyone can change
// their own PIN (current PIN required) and save their own prefs.

const publicUser = (u: typeof users.$inferSelect) =>
  ({ id: u.id, name: u.name, role: u.role, active: u.active, hasPin: !!u.pinHash });

/** Refuse a change that would leave no active admin able to sign in. */
async function guardLastAdmin(target: typeof users.$inferSelect, reply: FastifyReply): Promise<boolean> {
  const isLiveAdmin = target.role === 'admin' && target.active && !!target.pinHash;
  if (isLiveAdmin && (await activeAdminCount()) <= 1) {
    reply.code(409).send({ error: 'This is the last active admin — make someone else admin first.' });
    return false;
  }
  return true;
}

export async function userRoutes(app: FastifyInstance) {
  // ?all=1 includes deactivated accounts (Settings → Accounts).
  app.get('/api/users', async (req) => {
    const all = (req.query as { all?: string }).all === '1';
    const rows = await db.select().from(users);
    return rows.filter((u) => all || u.active).map(publicUser);
  });

  // Own prefs (theme, accent, dashboard cards) — always the signed-in account.
  app.put('/api/users/prefs', {
    schema: { body: { type: 'object', required: ['prefs'], additionalProperties: false,
      properties: { prefs: { type: 'object', additionalProperties: true } } } },
  }, async (req) => {
    const { prefs } = req.body as { prefs: object };
    await db.update(users).set({ prefs: JSON.stringify(prefs) }).where(eq(users.id, req.user!.id));
    return { ok: true };
  });

  // Own PIN change — the current PIN is required even with a live session.
  app.put('/api/users/me/pin', {
    schema: { body: { type: 'object', required: ['current', 'next'], additionalProperties: false,
      properties: { current: { type: 'string', maxLength: 100 }, next: { type: 'string', pattern: PIN_PATTERN } } } },
  }, async (req, reply) => {
    const { current, next } = req.body as { current: string; next: string };
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id));
    if (!(await verifyPin(current, u?.pinHash ?? null))) return reply.code(401).send({ error: 'Wrong current PIN' });
    await db.update(users).set({ pinHash: await hashPin(next) }).where(eq(users.id, u.id));
    // Sign out this account everywhere else; the session that changed it stays.
    const token = req.headers.authorization?.slice(7).trim();
    await revokeUserSessions(u.id, token);
    return { ok: true };
  });

  // Admin: create an account (re-activates + resets a deactivated same-name one).
  app.post('/api/users', {
    schema: { body: { type: 'object', required: ['name', 'role', 'pin'], additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        role: { type: 'string', enum: [...USER_ROLES] },
        pin: { type: 'string', pattern: PIN_PATTERN },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const { name, role, pin } = req.body as { name: string; role: UserRole; pin: string };
    const pinHash = await hashPin(pin);
    const [existing] = await db.select().from(users).where(eq(users.name, name.trim()));
    if (existing) {
      if (existing.active) return reply.code(409).send({ error: 'An account with that name already exists' });
      const [row] = await db.update(users).set({ active: true, role, pinHash, password: null })
        .where(eq(users.id, existing.id)).returning();
      return publicUser(row);
    }
    const [row] = await db.insert(users).values({ name: name.trim(), role, pinHash }).returning();
    reply.code(201);
    return publicUser(row);
  });

  // Admin: change role and/or (re)activate.
  app.put('/api/users/:id', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: { role: { type: 'string', enum: [...USER_ROLES] }, active: { type: 'boolean' } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { role?: UserRole; active?: boolean };
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) return reply.code(404).send({ error: 'User not found' });
    const demoting = b.role !== undefined && b.role !== 'admin';
    if ((demoting || b.active === false) && !(await guardLastAdmin(u, reply))) return reply;
    const [row] = await db.update(users).set(b).where(eq(users.id, id)).returning();
    // Role/active changes take effect now, not at the next sign-in.
    if (b.active === false || (b.role !== undefined && b.role !== u.role)) await revokeUserSessions(id);
    return publicUser(row);
  });

  // Admin: reset someone's PIN (signs them out everywhere).
  app.put('/api/users/:id/pin', {
    schema: { body: { type: 'object', required: ['pin'], additionalProperties: false,
      properties: { pin: { type: 'string', pattern: PIN_PATTERN } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { pin } = req.body as { pin: string };
    const [row] = await db.update(users).set({ pinHash: await hashPin(pin), password: null })
      .where(eq(users.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'User not found' });
    await revokeUserSessions(id);
    return publicUser(row);
  });

  // Admin: deactivate (the old "remove" button — no hard delete).
  app.delete('/api/users/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) return reply.code(404).send({ error: 'User not found' });
    if (!(await guardLastAdmin(u, reply))) return reply;
    await db.update(users).set({ active: false }).where(eq(users.id, id));
    await revokeUserSessions(id);
    return { ok: true };
  });
}
