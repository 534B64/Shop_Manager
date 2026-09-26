// "Load more" lists on the keyset endpoints ({ rows, nextBefore }). Changing
// the URL/params starts over; stale responses are dropped.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../../../lib/api';
import { withParams, type Params } from '../../../lib/query';
import { errorText } from '../logic';
import type { KeysetPage } from '../types';

export function useKeyset<T>(url: string | null, params: Params = {}, limit = 25) {
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
