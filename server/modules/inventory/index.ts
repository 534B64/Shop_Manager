// Inventory module interface: item counts, adjustments, cycle counts (blind
// count v2 + variance review), roll SKUs, the advisory stock-check endpoints,
// suppliers, and the category taxonomy (inventory-only by decision — see
// CONTEXT.md "Category"). recordSale is the one write other modules may call
// (payments' counter-sale deduction) — everything else stays internal.
export { inventoryRoutes } from './routes.js';
export { categoryRoutes } from './categories.routes.js';
export { supplierRoutes } from './suppliers.routes.js';
export { recordSale } from './service.js';
