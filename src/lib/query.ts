// Data hooks on top of lib/api.ts (the one fetch layer — token, 401, approval
// retry, network retry all happen there). No caching library by decision:
// each page loads what it shows, and lists are server-paged.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, ApiError } from './api';

export type Params = Record<string, string | number | boolean | null | undefined>;

/** Append params to a URL, skipping empty values ('' / null / undefined / false). */
export function withParams(url: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, v === true ? '1' : String(v));
  }
  const s = q.toString();
  return s ? `${url}${url.includes('?') ? '&' : '?'}${s}` : url;
}

const message = (e: unknown) =>
  e instanceof ApiError ? (typeof e.data.message === 'string' ? e.data.message : e.message)
    : e instanceof Error ? (e.message === 'Failed to fetch' ? 'Can’t reach the server — check the wifi.' : e.message)
    : 'Something went wrong';

export interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Replace the data locally (after a mutation that returned the new value). */
  setData: (d: T) => void;
}

/** GET `url` (null = don't fetch yet). Re-fetches when the URL changes; stale responses are dropped. */
export function useQuery<T>(url: string | null): QueryState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(url != null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (url == null) { setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true); setError(null);
    get<T>(url)
      .then((d) => { if (mine === seq.current) setData(d); })
      .catch((e) => { if (mine === seq.current) setError(message(e)); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Server paging contract (see docs/UI-GUIDE.md): GET url?limit=&offset=&… → Page<T>. */
export interface Page<T> { rows: T[]; total: number; limit: number; offset: number }

export interface Paging {
  page: number; pageSize: number; total: number; pageCount: number;
  hasPrev: boolean; hasNext: boolean; prev: () => void; next: () => void; setPage: (p: number) => void;
}

export interface PagedState<T> extends Paging {
  rows: T[]; loading: boolean; error: string | null; reload: () => void;
  /** The whole last response, for endpoints that send extras beside rows (e.g. inventory `groups`). */
  data?: Page<T> & Record<string, unknown>;
}

/** True when row `i` starts a new group (DataTable draws a header row there). */
export function startsGroup(keys: (string | undefined)[], i: number): boolean {
  return keys[i] != null && (i === 0 || keys[i] !== keys[i - 1]);
}

/** Page math shared by the hook and DataTable. */
export function pageInfo(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return { pageCount, from, to, hasPrev: page > 0, hasNext: page + 1 < pageCount };
}

/**
 * One page of a server-paged list. Changing `params` (search, filters, sort)
 * goes back to page 1. The previous page stays on screen while the next loads.
 */
export function usePaged<T>(url: string, params: Params = {}, opts: { pageSize?: number } = {}): PagedState<T> {
  const pageSize = opts.pageSize ?? 25;
  const key = withParams(url, params);
  const [page, setPage] = useState(0);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setPage(0); } // reset during render, no extra fetch
  const q = useQuery<Page<T> & Record<string, unknown>>(withParams(key, { limit: pageSize, offset: page * pageSize }));
  const total = q.data?.total ?? 0;
  const info = pageInfo(page, pageSize, total);
  // A page past the end (rows archived meanwhile) snaps back to the last one.
  useEffect(() => { if (q.data && page > 0 && page >= info.pageCount) setPage(info.pageCount - 1); }, [q.data, page, info.pageCount]);
  return {
    rows: q.data?.rows ?? [], total, page, pageSize, pageCount: info.pageCount,
    hasPrev: info.hasPrev, hasNext: info.hasNext,
    prev: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => (p + 1 < info.pageCount ? p + 1 : p)),
    setPage, loading: q.loading, error: q.error, reload: q.reload, data: q.data,
  };
}
