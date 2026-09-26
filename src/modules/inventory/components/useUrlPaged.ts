// usePaged whose page number lives in the URL, so back/forward and bookmarks
// reopen the same page. `page` is 0-based; `setPage` writes the URL.
import { useEffect, useRef } from 'react';
import { usePaged, type Params, type PagedState } from '../../../lib/query';

export function useUrlPaged<T>(url: string, params: Params, page: number, setPage: (p: number) => void,
  opts: { pageSize?: number } = {}): PagedState<T> {
  const p = usePaged<T>(url, params, opts);
  const applied = useRef<number | null>(null);
  useEffect(() => {
    if (applied.current === page) return;
    applied.current = page;
    if (p.page !== page) p.setPage(page);
  });
  return {
    ...p,
    prev: () => { if (p.hasPrev) setPage(p.page - 1); },
    next: () => { if (p.hasNext) setPage(p.page + 1); },
    setPage,
  };
}
