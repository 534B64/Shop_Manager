// Sales routes (Phase 3, ADR 0007): counter sale (moved here from payments,
// same path), invoices, invoice voids, returns, and the cash drawer — one
// file per area, registered together.
import type { FastifyInstance } from 'fastify';
import { saleRoutes } from './sale.routes.js';
import { invoiceRoutes } from './invoices.routes.js';
import { returnRoutes } from './returns.routes.js';
import { drawerRoutes } from './drawer.routes.js';

export async function salesRoutes(app: FastifyInstance) {
  await saleRoutes(app);
  await invoiceRoutes(app);
  await returnRoutes(app);
  await drawerRoutes(app);
}
