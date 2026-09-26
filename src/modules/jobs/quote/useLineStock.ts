// Vinyl color lists per roll material, and the advisory stock check for every
// line in ONE batched, debounced request. A lookup only — it never blocks a
// quote and never deducts stock (CONTEXT.md: Stock check).
import { useEffect, useState } from 'react';
import { get, post } from '../../../lib/api';
import type { Material, MaterialColor, StockResult } from '../../../lib/types';
import type { LineDraft } from './draft';

export function useLineStock(lines: LineDraft[], materials: Material[]) {
  const [colors, setColors] = useState<Record<number, MaterialColor[]>>({});
  const [stock, setStock] = useState<(StockResult | null)[]>([]);
  const rollOf = (l: LineDraft) => materials.find((m) => m.id === l.materialId && m.usesRoll) ?? null;

  // Load each roll material's color list once.
  const wanted = [...new Set(lines.map((l) => rollOf(l)?.id).filter((id): id is number => id != null))]
    .filter((id) => !(id in colors));
  const wantedKey = wanted.join(',');
  useEffect(() => {
    for (const id of wanted) {
      setColors((c) => ({ ...c, [id]: c[id] ?? [] }));
      get<MaterialColor[]>(`/api/materials/${id}/colors`)
        .then((list) => setColors((c) => ({ ...c, [id]: list })))
        .catch(() => { /* no colors → no check */ });
    }
  }, [wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = lines.map((l) => (rollOf(l) && l.materialColor
    ? { materialId: l.materialId, color: l.materialColor, widthIn: Number(l.widthIn) || null, heightIn: Number(l.heightIn) || null }
    : { materialId: null, color: '' }));
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (!query.some((q) => q.materialId)) { setStock([]); return; }
    let live = true;
    const t = setTimeout(() => {
      post<{ results: StockResult[] }>('/api/stock-check/batch', { lines: query })
        .then(({ results }) => { if (live) setStock(results.map((r, i) => (query[i].materialId ? r : null))); })
        .catch(() => { if (live) setStock([]); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    colorsFor: (materialId: number | null) => (materialId != null ? colors[materialId] ?? [] : []),
    stockAt: (i: number) => stock[i] ?? null,
  };
}
