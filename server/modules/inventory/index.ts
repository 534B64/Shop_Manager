// Inventory module interface: the perpetual ledger (ADR 0006 — every on-hand
// change is an inventory transaction posted through postTransaction), items,
// locations, cycle counts (blind count v2 + submit/approve/post), roll SKUs,
// the advisory stock-check endpoints, suppliers, and the category taxonomy
// (inventory-only by decision — see CONTEXT.md "Category"). recordSale is the
// write payments calls today (counter-sale deduction); recordReturn and
// recordProduction are there for later callers (Phase 3 returns; production
// is a transaction type only, no workflow).
export { inventoryRoutes } from './routes.js';
export { cycleCountRoutes } from './cycle-counts.routes.js';
export { locationRoutes } from './locations.routes.js';
export { categoryRoutes } from './categories.routes.js';
export { supplierRoutes } from './suppliers.routes.js';
export {
  postTransaction, receive, adjust, transfer, recordSale, recordReturn, recordProduction, reconcile,
  InventoryError, DEFAULT_LOCATION_ID,
  type PostTransactionInput, type TxnSource, type TxnUser,
} from './service.js';
