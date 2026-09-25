import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema/index.js';
import {
  verifyCredentials, isRateLimited, createSession, revokeSession, bearerToken,
  activeAdminCount, hashPin,
} from './service.js';

export const PIN_PATTERN = '^[0-9]{4,12}$';

export async function authRoutes(app: FastifyInstance) {
  // Public: what the sign-in screen needs before anyone is signed in — the
  // account picker (names only; names are not secrets in a 5-person shop, the
  // PIN + rate limit are the guard) and whether first-run setup is open.
  app.get('/api/auth/status', async () => {
    const rows = await db.select().from(users);
    return {
      needsSetup: (await activeAdminCount()) === 0,
      accounts: rows.filter((u) => u.active && u.pinHash).map((u) => ({ id: u.id, name: u.name })),
    };
  });

  // First-run only: creates the first admin when no active admin can sign in
  // (fresh install, or every legacy account had no password). Closed after.
  app.post('/api/auth/setup', {
    schema: { body: { type: 'object', required: ['name', 'pin'], additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        pin: { type: 'string', pattern: PIN_PATTERN },
      } } },
  }, async (req, reply) => {
    if ((await activeAdminCount()) > 0) return reply.code(409).send({ error: 'Setup is already done — sign in.' });
    const { name, pin } = req.body as { name: string; pin: string };
    const pinHash = await hashPin(pin);
    const [existing] = await db.select().from(users).where(eq(users.name, name.trim()));
    const [u] = existing
      ? await db.update(users).set({ role: 'admin', pinHash, password: null, active: true }).where(eq(users.id, existing.id)).returning()
      : await db.insert(users).values({ name: name.trim(), role: 'admin', pinHash }).returning();
    const token = await createSession(u.id);
    reply.code(201);
    return { token, user: { id: u.id, name: u.name, role: u.role, prefs: null } };
  });

  app.post('/api/auth/login', {
    schema: { body: { type: 'object', required: ['name', 'pin'], additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, pin: { type: 'string', minLength: 1, maxLength: 100 } } } },
  }, async (req, reply) => {
    const { name, pin } = req.body as { name: string; pin: string };
    if (isRateLimited(name)) return reply.code(429).send({ error: 'Too many wrong PINs — wait a few minutes.' });
    const user = await verifyCredentials(name, pin);
    if (!user) return reply.code(401).send({ error: 'Wrong name or PIN' });
    return { token: await createSession(user.id), user };
  });

  app.post('/api/auth/logout', async (req) => {
    const token = bearerToken(req);
    if (token) await revokeSession(token);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));
}
