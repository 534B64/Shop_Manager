// Keyset ("before" cursor) paging for newest-first lists that answer
// { rows, nextBefore } — audit log, approvals, invoices, returns, drawer
// history, inventory transactions. Two shapes:
//   useKeyset     — one page at a time; the cursor stack makes Previous work (KeysetPager)
//   useKeysetMore — rows accumulate with "Load more" (inventory ledger tables)
// Both sit on lib/api.ts, so token / 401 / approval / retry all still apply.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';
import { errorText } from './errorText';
import { useQuery, withParams, type Params } from './query';

export interface KeysetPage<T> { rows: T[]; nextBefore: number | null }

export interface KeysetState<T> {
  rows: T[]; loading: boolean; error: string | null; reload: () => void;
  page: number; hasPrev: boolean; hasNext: boolean; prev: () => void; next: () => void;
}

/** Cursor stack math, kept pure for tests. [null] is page 1; each Next pushes that page's nextBefore. */
export const cursorStack = {
  next: (stack: (number | null)[], nextBefore: number | null) => (nextBefore == null ? stack : [...stack, nextBefore]),
  prev: (stack: (number | null)[]) => (stack.length > 1 ? stack.slice(0, -1) : stack),
};

/** One keyset page (url null = don't fetch). Changing the URL or params goes back to page 1. */
export function useKeyset<T>(url: string | null, params: Params = {}, pageSize = 50): KeysetState<T> {
  const key = url == null ? null : withParams(url, params);
  const [stack, setStack] = useState<(number | null)[]>([null]);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setStack([null]); } // new filters → first page
  const before = stack[stack.length - 1];
  const q = useQuery<KeysetPage<T>>(key == null ? null : withParams(key, { limit: pageSize, before }));
  const nextBefore = key == null ? null : q.data?.nextBefore ?? null;
  return {
    rows: key == null ? [] : q.data?.rows ?? [], loading: q.loading, error: q.error, reload: q.reload,
    page: stack.length, hasPrev: stack.length > 1, hasNext: nextBefore != null,
    prev: () => setStack((s) => cursorStack.prev(s)),
    next: () => setStack((s) => cursorStack.next(s, nextBefore)),
  };
}

export interface KeysetMoreState<T> {
  rows: T[]; loading: boolean; error: string | null; hasMore: boolean; loadMore: () => void; reload: () => void;
}

/** "Load more" over a keyset endpoint (url null = don't fetch). Changing the URL/params starts over. */
export function useKeysetMore<T>(url: string | null, params: Params = {}, limit = 25): KeysetMoreState<T> {
  const key = url ? withParams(url, { ...params, limit }) : null;
  const [rows, setRows] = useState<T[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  const load = useCallback((before: number | null) => {
    if (!key) return;
    const mine = ++seq.current;
    setLoading(true); setError(null);
    get<KeysetPage<T>>(withParams(key, { before }))
      .then((p) => {
        if (mine !== seq.current) return;
        setRows((r) => (before == null ? p.rows : [...r, ...p.rows]));
        setNext(p.nextBefore);
      })
      .catch((e) => { if (mine === seq.current) setError(errorText(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [key]);

  useEffect(() => { setRows([]); setNext(null); load(null); }, [load, tick]);

  return {
    rows, loading, error, hasMore: next != null,
    loadMore: () => { if (next != null && !loading) load(next); },
    reload: () => setTick((t) => t + 1),
  };
}
