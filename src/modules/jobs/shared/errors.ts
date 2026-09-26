import { ApiError } from '../../../lib/api';

/** A person-readable message from a failed request. */
export function errorText(e: unknown, fallback = 'Something went wrong — safe to retry.'): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && (e.data.error === 'approval_required' || e.data.error === 'approval_invalid')) {
      return 'Not done — this needs a manager’s approval.';
    }
    const m = e.data.message ?? e.data.error;
    return typeof m === 'string' && m ? m : e.message || fallback;
  }
  if (e instanceof Error) return e.message === 'Failed to fetch' ? 'Can’t reach the server — check the wifi, then retry.' : e.message;
  return fallback;
}

/** A cash sale refused because no drawer is open (409 drawer_closed, ADR 0007). */
export const isDrawerClosed = (e: unknown) => e instanceof ApiError && e.status === 409 && e.data.code === 'drawer_closed';

/** The job is invoiced and the edit touched a locked field (409, ADR 0007). */
export const lockedInvoice = (e: unknown): string | null =>
  e instanceof ApiError && e.status === 409 && typeof e.data.invoiceNumber === 'string' ? e.data.invoiceNumber : null;
