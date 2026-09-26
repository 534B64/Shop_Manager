// Server paging contract shared by list endpoints (ADR 0009, docs/UI-GUIDE.md).
//
//   GET /api/<list>?limit=25&offset=50&q=…&sort=name&dir=asc
//   → { rows: T[], total: number, limit: number, offset: number }
//
// Paging is opt-in: an endpoint answers in the paged shape only when `limit`
// or `offset` is present, so old clients that expect a bare array keep working.

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

export interface PageQuery { limit: number; offset: number }
export interface Page<T> { rows: T[]; total: number; limit: number; offset: number }

export class PagingError extends Error {}

const intParam = (v: unknown, name: string, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new PagingError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};

/** Null when the request isn't paged; throws PagingError on a bad value. */
export function parsePage(query: Record<string, unknown>): PageQuery | null {
  const { limit, offset } = query;
  if (limit === undefined && offset === undefined) return null;
  return {
    limit: limit === undefined || limit === '' ? DEFAULT_PAGE_SIZE : intParam(limit, 'limit', 1, MAX_PAGE_SIZE),
    offset: offset === undefined || offset === '' ? 0 : intParam(offset, 'offset', 0, Number.MAX_SAFE_INTEGER),
  };
}

/** A sort key from an allow-list (anything else → the default). */
export function parseSort<K extends string>(v: unknown, allowed: readonly K[], fallback: K): K {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as K) : fallback;
}

export const parseDir = (v: unknown): 'asc' | 'desc' => (v === 'desc' ? 'desc' : 'asc');

/** LIKE pattern for a user's search text; % and _ match literally (use with ESCAPE '\'). */
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
