import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations, DB_PATH } from './db/index.js';
import { authRoutes, authHook, upgradePlaintextPasswords } from './modules/auth/index.js';
import { materialRoutes } from './modules/materials/index.js';
import { customerRoutes } from './modules/customers/index.js';
import { jobRoutes } from './modules/jobs/index.js';
import { paymentRoutes } from './modules/payments/index.js';
import { inventoryRoutes, cycleCountRoutes, locationRoutes, categoryRoutes, supplierRoutes } from './modules/inventory/index.js';
import { settingsRoutes, getSetting } from './modules/settings/index.js';
import { userRoutes } from './modules/users/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { salesRoutes, salesReportRoutes } from './modules/sales/index.js';
import { rejectBadIds } from './lib/ids.js';
import { BUILD_INFO } from './lib/build-info.js';
import { reachableAddresses } from './lib/address.js';

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
  // A non-numeric id in a URL (/api/jobs/abc) is "not found", never a database error.
  app.addHook('onRequest', rejectBadIds);

  // Public. `dataset` ('demo' | 'production' | null = unlabeled, ADR 0008)
  // drives the client's DEMO DATA banner.  /  let the client notice
  // a server that was not restarted after an update (server/lib/build-info.ts).
  app.get('/api/health', async (req) => {
  const where = reachableAddresses(DB_PATH);
  return {
    ok: true,
    app: 'decals-plus-shop-manager',
    version: BUILD_INFO.version,
    build: BUILD_INFO.build,
    time: new Date().toISOString(),
    dataset: await getSetting('dataset'),
    // The port is public (the launcher scripts need it). The shop name and LAN IPs are only for signed-in users.
    port: where.port,
    ...(req.user ? { hostname: where.hostname, addresses: where.addresses } : {}),
  };
  });

  await app.register(authRoutes);
  await app.register(materialRoutes);
  await app.register(customerRoutes);
  await app.register(jobRoutes);
  await app.register(paymentRoutes);
  await app.register(inventoryRoutes);
  await app.register(cycleCountRoutes);
  await app.register(locationRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  await app.register(categoryRoutes);
  await app.register(supplierRoutes);
  await app.register(auditRoutes);
  await app.register(salesRoutes);
  await app.register(salesReportRoutes);

  return app;
}
