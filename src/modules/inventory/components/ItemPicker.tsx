import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, LinearProgress, TextField } from '../../../components/m3';
import { useQuery, withParams, type Page } from '../../../lib/query';
import type { InventoryItem } from '../../../lib/types';

/** Debounced value — keeps a request from going out on every keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Typeahead over the server-paged item list (never loads the whole table). */
export default function ItemPicker({ value, onChange, label = 'Item', autoFocus, touch }: {
  value: InventoryItem | null; onChange: (item: InventoryItem | null) => void; label?: string; autoFocus?: boolean; touch?: boolean;
}) {
  const [text, setText] = useState('');
  const term = useDebounced(text.trim());
  const q = useQuery<Page<InventoryItem>>(term ? withParams('/api/inventory', { q: term, limit: 8, offset: 0 }) : null);
  const res = { rows: q.data?.rows ?? [], total: q.data?.total ?? 0, loading: q.loading, error: q.error };
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (value) {
    return (
      <div className="flex items-center gap-3 min-h-14 px-4 rounded-shape-extra-small bg-surface-container-highest">
        <div className="flex-1 min-w-0">
          <div className="text-body-small text-on-surface-variant">{label}</div>
          <div className="text-body-large truncate">{value.name}</div>
        </div>
        <Button variant="text" touch={touch} onClick={() => { onChange(null); setTimeout(() => inputRef.current?.focus()); }}>Change</Button>
      </div>
    );
  }

  const buttons = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
  const onListKey = (e: KeyboardEvent) => {
    const all = buttons();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[Math.min(i + 1, all.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) inputRef.current?.focus(); else all[i - 1]?.focus(); }
  };
  const showResults = term !== '';
  return (
    <div>
      <TextField ref={inputRef} label={label} leadingIcon="search" value={text} autoFocus={autoFocus}
        placeholder="Type a name, color or vendor" autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); buttons()[0]?.focus(); } }} />
      {showResults && (
        <div className="mt-1 rounded-shape-extra-small border border-outline-variant bg-surface-container-low overflow-hidden">
          <div className="h-1">{res.loading && <LinearProgress label="Searching items" />}</div>
          {res.error && <p role="alert" className="px-4 py-3 text-body-medium text-error">{res.error}</p>}
          {!res.loading && !res.error && res.rows.length === 0 && (
            <p className="px-4 py-3 text-body-medium text-on-surface-variant">No items match “{term}”.</p>
          )}
          <ul ref={listRef} aria-label="Matching items" onKeyDown={onListKey}>
            {res.rows.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => { onChange(i); setText(''); }}
                  className="state-layer w-full flex items-center gap-3 min-h-12 px-4 py-2 text-left">
                  <span className="flex-1 min-w-0 truncate text-body-large text-on-surface">{i.name}</span>
                  <span className="text-body-medium text-on-surface-variant whitespace-nowrap">{i.count} on hand</span>
                </button>
              </li>
            ))}
          </ul>
          {res.total > res.rows.length && (
            <p className="px-4 py-2 text-body-small text-on-surface-variant">{res.total - res.rows.length} more — keep typing to narrow it down.</p>
          )}
        </div>
      )}
    </div>
  );
}
