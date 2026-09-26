import { ApiError } from '../../../lib/api';

/** A readable message for a failed request (the server's own words when it sent some). */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.data.message === 'string') return e.data.message;
    if (e.status === 403 && e.message === 'Manager approval cancelled') return 'Cancelled — a manager didn’t approve it.';
    return e.message;
  }
  if (e instanceof Error) return e.message === 'Failed to fetch' ? 'Can’t reach the server — check the wifi and try again.' : e.message;
  return 'Something went wrong';
}

/** Cash was refused because no drawer is open (409 drawer_closed). */
export const isDrawerClosed = (e: unknown) => e instanceof ApiError && e.data.code === 'drawer_closed';

/** A network failure (no HTTP answer) — the write may or may not have landed. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);
