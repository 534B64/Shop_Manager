import { useEffect, useRef, useState } from 'react';
import { Icon, List, ListItem, TextField, LinearProgress } from '../../../components/m3';
import { useQuery, withParams, type Page } from '../../../lib/query';
import type { InventoryItem } from '../../../lib/types';

/** Type to find a stock item (server-paged search), or add what you typed as a custom line. */
export default function AddItem({ onStock, onCustom }: {
  onStock: (item: InventoryItem) => void; onCustom: (description: string) => void;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 200); return () => clearTimeout(t); }, [text]);
  const res = useQuery<Page<InventoryItem>>(q ? withParams('/api/inventory', { limit: 8, offset: 0, q }) : null);
  const rows = q ? res.data?.rows ?? [] : [];

  const done = () => { setText(''); setQ(''); ref.current?.focus(); };

  return (
    <div>
      <TextField ref={ref} label="Add an item — search stock or type a description" leadingIcon="search"
        value={text} autoComplete="off" onChange={(e) => setText(e.target.value)} error={res.error}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !text.trim()) return;
          e.preventDefault();
          if (rows.length === 1) onStock(rows[0]); else onCustom(text);
          done();
        }} />
      <div className="h-1">{res.loading && q && <LinearProgress label="Searching stock" />}</div>
      {text.trim() && (
        <List label="Add to sale" className="py-0 rounded-shape-small border border-outline-variant">
          {rows.map((it) => (
            <ListItem key={it.id} leading={<Icon name="inventory" />} headline={it.name}
              supportingText={`${it.count} on hand${it.color ? ` · ${it.color}` : ''}`}
              trailing="Add" onClick={() => { onStock(it); done(); }} />
          ))}
          <ListItem leading={<Icon name="add" />} headline={`Add “${text.trim()}” as a custom item`}
            supportingText="Not from stock — you enter the price" onClick={() => { onCustom(text); done(); }} />
        </List>
      )}
    </div>
  );
}
