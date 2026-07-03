import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations } from './db/index.js';
import { materialRoutes } from './modules/materials/index.js';
import { customerRoutes } from './modules/customers/index.js';
import { jobRoutes } from './modules/jobs/index.js';
import { paymentRoutes } from './modules/payments/index.js';
import { inventoryRoutes, categoryRoutes } from './modules/inventory/index.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';

/**
 * Build the API with all routes registered, run migrations, but do NOT listen.
 * The HTTP server (index.ts) and the integration tests both build from here so
 * they exercise the exact same wiring.
 */
export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  // Migrations run at build — a fresh SQLite file always comes up clean.
  await runMigrations();

  app.get('/api/health', async () => ({
    ok: true,
    app: 'decals-plus-shop-manager',
    time: new Date().toISOString(),
  }));

  await app.register(materialRoutes);
  await app.register(customerRoutes);
  await app.register(jobRoutes);
  await app.register(paymentRoutes);
  await app.register(inventoryRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  await app.register(categoryRoutes);

  return app;
}
