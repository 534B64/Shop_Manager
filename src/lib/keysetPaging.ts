// Keyset ("before" cursor) paging for newest-first lists that answer
// { rows, nextBefore } — audit log, approvals, invoices, drawer history.
// The page stack remembers the cursor of every page seen, so Previous works.
import { useState } from 'react';
import { useQuery, withParams, type Params } from './query';

export interface KeysetPage<T> { rows: T[]; nextBefore: number | null }

export interface KeysetState<T> {
  rows: T[]; loading: boolean; error: string | null; reload: () => void;
  page: number; hasPrev: boolean; hasNext: boolean; prev: () => void; next: () => void;
}

/** Cursor stack math, kept pure for tests. */
export const cursorStack = {
  next: (stack: (number | null)[], nextBefore: number | null) => (nextBefore == null ? stack : [...stack, nextBefore]),
  prev: (stack: (number | null)[]) => (stack.length > 1 ? stack.slice(0, -1) : stack),
};

export function useKeyset<T>(url: string, params: Params = {}, pageSize = 50): KeysetState<T> {
  const key = withParams(url, params);
  const [stack, setStack] = useState<(number | null)[]>([null]);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setStack([null]); } // new filters → first page
  const before = stack[stack.length - 1];
  const q = useQuery<KeysetPage<T>>(withParams(key, { limit: pageSize, before }));
  const nextBefore = q.data?.nextBefore ?? null;
  return {
    rows: q.data?.rows ?? [], loading: q.loading, error: q.error, reload: q.reload,
    page: stack.length, hasPrev: stack.length > 1, hasNext: nextBefore != null,
    prev: () => setStack((s) => cursorStack.prev(s)),
    next: () => setStack((s) => cursorStack.next(s, nextBefore)),
  };
}
