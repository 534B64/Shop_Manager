// The one place that turns a failed request into words for a person, plus the
// error checks pages branch on. Every page imports these (no local copies).
import { ApiError } from './api';

/** True when the user closed the manager-approval dialog (not worth an error). */
export const approvalCancelled = (e: unknown) => e instanceof ApiError && e.message === 'Manager approval cancelled';

/** A readable sentence for a failed request (the server's own words first). */
export function errorText(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) {
    if (typeof e.data.message === 'string' && e.data.message) return e.data.message;
    if (approvalCancelled(e)) return 'Not done — a manager didn’t approve it.';
    return e.message || fallback;
  }
  if (e instanceof Error) return e.message === 'Failed to fetch' ? 'Can’t reach the server — check the wifi and try again.' : e.message || fallback;
  return fallback;
}

/** A sale/payment/refund refused because no drawer is open (409 drawer_closed, ADR 0007 D12 — any method). */
export const isDrawerClosed = (e: unknown) => e instanceof ApiError && e.status === 409 && e.data.code === 'drawer_closed';

/** The job is invoiced and the edit touched a locked field (409, ADR 0007) → that invoice's number. */
export const lockedInvoice = (e: unknown): string | null =>
  e instanceof ApiError && e.status === 409 && typeof e.data.invoiceNumber === 'string' ? e.data.invoiceNumber : null;

/** A network failure (no HTTP answer) — the write may or may not have landed. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);
