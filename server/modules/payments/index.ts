// Payments module interface (ADR 0002): routes + the money math other
// modules are allowed to use. Nothing outside this folder imports
// routes.ts/service.ts directly. recordPayment is the single writer of
// payment rows (Phase 3, ADR 0007) — the drawer rule (D12) lives there.
export { paymentRoutes, PAYMENT_METHODS } from './routes.js';
export {
  creditBalanceCents, paidNetCents, livePaymentCount, returnedCents, owedCents,
  openDrawer, requireOpenDrawer, recordPayment, PaymentError, NO_DRAWER_MESSAGE, type RecordPaymentInput,
} from './service.js';
