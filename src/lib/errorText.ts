import { ApiError } from './api';

/** A readable sentence for a failed request (server message first). */
export function errorText(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) return typeof e.data.message === 'string' ? e.data.message : e.message || fallback;
  if (e instanceof Error) return e.message === 'Failed to fetch' ? 'Can’t reach the server — check the wifi.' : e.message || fallback;
  return fallback;
}

/** True when the user closed the manager-approval dialog (not worth an error). */
export const approvalCancelled = (e: unknown) => e instanceof ApiError && e.message === 'Manager approval cancelled';
