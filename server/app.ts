import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations } from './db/index.js';
import { materialRoutes } from './routes/materials.js';
import { customerRoutes } from './routes/customers.js';
import { jobRoutes } from './routes/jobs.js';
import { paymentRoutes } from './routes/payments.js';
import { inventoryRoutes } from './routes/inventory.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { categoryRoutes } from './routes/categories.js';

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
