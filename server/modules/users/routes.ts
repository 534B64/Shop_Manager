import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema/index.js';
import { getSetting, setSetting, requireAdmin } from '../settings/index.js';
import { verifyUser } from './service.js';

// Plain-text passwords on purpose: this is a LAN shop tool gating actions,
// not protecting secrets. Admin password gates account management.

export async function userRoutes(app: FastifyInstance) {
  app.get('/api/users', async () => {
    const rows = await db.select().from(users);
    return rows.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  });

  // Sign-in: verify password, return account prefs.
  app.post('/api/users/verify', {
    schema: { body: { type: 'object', required: ['name', 'password'], additionalProperties: false,
      properties: { name: { type: 'string' }, password: { type: 'string' } } } },
  }, async (req, reply) => {
    const { name, password } = req.body as { name: string; password: string };
    if (!(await verifyUser(name, password))) return reply.code(401).send({ error: 'Wrong name or password' });
    const [u] = await db.select().from(users).where(eq(users.name, name));
    let prefs = null;
    try { prefs = u.prefs ? JSON.parse(u.prefs) : null; } catch { /* ignore */ }
    return { ok: true, prefs };
  });

  app.put('/api/users/prefs', {
    schema: { body: { type: 'object', required: ['name', 'password', 'prefs'], additionalProperties: false,
      properties: { name: { type: 'string' }, password: { type: 'string' }, prefs: { type: 'object', additionalProperties: true } } } },
  }, async (req, reply) => {
    const { name, password, prefs } = req.body as { name: string; password: string; prefs: object };
    if (!(await verifyUser(name, password))) return reply.code(401).send({ error: 'Wrong password' });
    await db.update(users).set({ prefs: JSON.stringify(prefs) }).where(eq(users.name, name));
    return { ok: true };
  });

  // Admin-only: create account (with password) / deactivate / reset password.
  app.post('/api/users', {
    schema: { body: { type: 'object', required: ['name', 'password', 'adminPassword'], additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        password: { type: 'string', minLength: 3, maxLength: 100 },
        adminPassword: { type: 'string' },
      } } },
  }, async (req, reply) => {
    const { name, password, adminPassword: ap } = req.body as { name: string; password: string; adminPassword: string };
    if (!(await requireAdmin(ap))) return reply.code(401).send({ error: 'Admin password required' });
    const [existing] = await db.select().from(users).where(eq(users.name, name));
    if (existing) {
      const [row] = await db.update(users).set({ active: true, password }).where(eq(users.id, existing.id)).returning();
      return { id: row.id, name: row.name };
    }
    const [row] = await db.insert(users).values({ name, password }).returning();
    reply.code(201);
    return { id: row.id, name: row.name };
  });

  app.delete('/api/users/:id', {
    schema: { body: { type: 'object', required: ['adminPassword'], additionalProperties: false,
      properties: { adminPassword: { type: 'string' } } } },
  }, async (req, reply) => {
    const { adminPassword: ap } = req.body as { adminPassword: string };
    if (!(await requireAdmin(ap))) return reply.code(401).send({ error: 'Admin password required' });
    const id = Number((req.params as { id: string }).id);
    const [row] = await db.update(users).set({ active: false }).where(eq(users.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'User not found' });
    return { ok: true };
  });

  // Non-blocking trust check: is the admin password still the default 'admin'?
  // Drives a persistent banner urging a change. Never exposes the password.
  app.get('/api/admin/status', async () => {
    return { isDefault: ((await getSetting('adminPassword')) ?? 'admin') === 'admin' };
  });

  app.post('/api/admin/login', {
    schema: { body: { type: 'object', required: ['password'], additionalProperties: false,
      properties: { password: { type: 'string', maxLength: 100 } } } },
  }, async (req, reply) => {
    const { password } = req.body as { password: string };
    if (!(await requireAdmin(password))) return reply.code(401).send({ error: 'Wrong password' });
    return { ok: true };
  });

  app.put('/api/admin/password', {
    schema: { body: { type: 'object', required: ['current', 'next'], additionalProperties: false,
      properties: { current: { type: 'string', maxLength: 100 }, next: { type: 'string', minLength: 3, maxLength: 100 } } } },
  }, async (req, reply) => {
    const { current, next } = req.body as { current: string; next: string };
    if (!(await requireAdmin(current))) return reply.code(401).send({ error: 'Wrong current password' });
    await setSetting('adminPassword', next);
    return { ok: true };
  });
}
