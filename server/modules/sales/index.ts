// Sales module interface (Phase 3, ADR 0007): the counter sale, invoices,
// invoice voids, returns, and the cash drawer. Other modules call:
//   invoiceJob / invoiceIfSettled — issue a job's invoice (pickup, paid in full)
//   liveInvoiceForJob             — "is this job locked?" (jobs edit/remove)
export { salesRoutes } from './routes.js';
export { invoiceJob, invoiceIfSettled, liveInvoiceForJob, SalesError } from './service.js';
