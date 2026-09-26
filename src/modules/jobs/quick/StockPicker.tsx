// Optional "from stock" link: searches inventory server-side (paged, 8 at a
// time); picking an item makes the sale deduct it on the server.
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { IconButton, TextField, cx } from '../../../components/m3';
import { get } from '../../../lib/api';
import type { InventoryItem } from '../../../lib/types';
import type { Page } from '../../../lib/query';

interface Props {
  item: InventoryItem | null;
  qty: string;
  onPick: (i: InventoryItem | null) => void;
  onQty: (q: string) => void;
}

export default function StockPicker({ item, qty, onPick, onQty }: Props) {
  const id = useId();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A finished sale clears the item — start the next search empty.
  useEffect(() => { if (!item) { setText(''); setRows([]); } }, [item]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || item) { setRows([]); return; }
    let live = true;
    const t = setTimeout(() => {
      get<Page<InventoryItem>>(`/api/inventory?limit=8&offset=0&q=${encodeURIComponent(q)}`)
        .then((p) => { if (live) { setRows(p.rows); setActive(0); setError(null); } })
        .catch(() => { if (live) { setRows([]); setError('Couldn’t search stock — the sale can still go through without it.'); } });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [text, item]);

  if (item) {
    return (
      <div className="flex items-center gap-2">
        <p className="flex-1 min-h-14 flex items-center px-4 rounded-shape-extra-small bg-secondary-container text-on-secondary-container text-body-large">
          <span className="truncate">From stock: <b>{item.name}</b> ({item.count} on hand)</span>
        </p>
        <TextField label="Qty" inputMode="numeric" value={qty} className="w-24" onChange={(e) => onQty(e.target.value)} />
        <IconButton icon="close" label="Don’t take from stock" touch onClick={() => { onPick(null); setText(''); }} />
      </div>
    );
  }
  const open = rows.length > 0;
  const pick = (i: InventoryItem) => { onPick(i); setRows([]); };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setRows([]); }
  };
  return (
    <div className="relative">
      <TextField label="From stock? (optional — type an inventory item)" leadingIcon="inventory" value={text} autoComplete="off"
        error={error} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => setRows([])} />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Matching stock items"
          className="absolute z-20 left-0 right-0 mt-1 py-2 rounded-shape-extra-small bg-surface-container shadow-elevation-2">
          {rows.map((i, n) => (
            <li key={i.id} id={`${id}-${n}`} role="option" aria-selected={n === active}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setActive(n)}
              className={cx('px-4 min-h-12 flex items-center gap-3 cursor-pointer text-body-large',
                n === active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface')}>
              <span className="flex-1 truncate">{i.name}</span>
              <span className="text-body-medium">{i.count} on hand</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
