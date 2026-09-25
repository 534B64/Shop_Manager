import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations } from './db/index.js';
import { authRoutes, authHook, upgradePlaintextPasswords } from './modules/auth/index.js';
import { materialRoutes } from './modules/materials/index.js';
import { customerRoutes } from './modules/customers/index.js';
import { jobRoutes } from './modules/jobs/index.js';
import { paymentRoutes } from './modules/payments/index.js';
import { inventoryRoutes, categoryRoutes, supplierRoutes } from './modules/inventory/index.js';
import { settingsRoutes } from './modules/settings/index.js';
import { userRoutes } from './modules/users/index.js';
import { auditRoutes } from './modules/audit/index.js';

/**
 * Build the API with all routes registered, run migrations, but do NOT listen.
 * The HTTP server (index.ts) and the integration tests both build from here so
 * they exercise the exact same wiring.
 */
export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  // Migrations run at build — a fresh SQLite file always comes up clean.
  await runMigrations();
  // Pre-0013 plaintext passwords → scrypt pin_hash, plaintext NULLed (idempotent).
  await upgradePlaintextPasswords();

  // Every /api route resolves req.user from the bearer token; 401 without one
  // except the public auth endpoints + health (ADR 0004). Registered on the
  // root instance so it covers every plugin below.
  app.decorateRequest('user', null);
  app.addHook('onRequest', authHook);

  app.get('/api/health', async () => ({
    ok: true,
    app: 'decals-plus-shop-manager',
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(materialRoutes);
  await app.register(customerRoutes);
  await app.register(jobRoutes);
  await app.register(paymentRoutes);
  await app.register(inventoryRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  await app.register(categoryRoutes);
  await app.register(supplierRoutes);
  await app.register(auditRoutes);

  return app;
}
