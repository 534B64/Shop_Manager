// Keyset paging for the sales lists (/api/invoices, /api/returns, /api/drawer
// answer {rows, nextBefore}; pass ?before=<nextBefore> for the next page).
// Built on useQuery (lib/query.ts), so token/retry/approval all still apply.
import { useState } from 'react';
import { useQuery, withParams, type Params } from '../../../lib/query';
import type { KeysetPage } from '../types';

/** Cursor stack: [null] is page 1; each Next pushes the page's nextBefore. */
export interface Cursors { stack: (number | null)[] }

export const firstPage = (): Cursors => ({ stack: [null] });
export const cursorOf = (c: Cursors) => c.stack[c.stack.length - 1];
export const nextPage = (c: Cursors, nextBefore: number | null): Cursors =>
  nextBefore == null ? c : { stack: [...c.stack, nextBefore] };
export const prevPage = (c: Cursors): Cursors => (c.stack.length > 1 ? { stack: c.stack.slice(0, -1) } : c);

export interface KeysetState<T> {
  rows: T[]; loading: boolean; error: string | null; reload: () => void;
  page: number; hasPrev: boolean; hasNext: boolean; prev: () => void; next: () => void;
}

/** One keyset page. Changing `params` goes back to page 1. */
export function useKeyset<T>(url: string, params: Params = {}, pageSize = 25): KeysetState<T> {
  const key = withParams(url, params);
  const [cursors, setCursors] = useState(firstPage);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setCursors(firstPage()); }
  const q = useQuery<KeysetPage<T>>(withParams(key, { limit: pageSize, before: cursorOf(cursors) }));
  const nextBefore = q.data?.nextBefore ?? null;
  return {
    rows: q.data?.rows ?? [], loading: q.loading, error: q.error, reload: q.reload,
    page: cursors.stack.length, hasPrev: cursors.stack.length > 1, hasNext: nextBefore != null,
    prev: () => setCursors(prevPage), next: () => setCursors((c) => nextPage(c, nextBefore)),
  };
}
