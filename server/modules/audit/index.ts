// Audit module interface (ADR 0005): `audit(tx, req, …)` — every mutating
// route calls it inside the same transaction as its change — and the
// admin-only read/CSV routes.
export { auditRoutes } from './routes.js';
export { audit, type AuditEntry } from './service.js';
