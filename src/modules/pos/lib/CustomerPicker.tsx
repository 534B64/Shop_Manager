import { useEffect, useState } from 'react';
import { Chip, List, ListItem, TextField } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import type { Customer } from '../../../lib/types';

export interface PickedCustomer { id: number; name: string; phone?: string | null }

/** Walk-in (no customer) by default, or search by name / phone. */
export default function CustomerPicker({ value, onChange, emptyLabel = 'Walk-in', label = 'Customer' }: {
  value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; emptyLabel?: string; label?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const res = useQuery<Customer[]>(q.length >= 2 ? `/api/customers?q=${encodeURIComponent(q)}` : null);
  const matches = q.length >= 2 ? (res.data ?? []).slice(0, 6) : [];

  const pick = (c: PickedCustomer | null) => { onChange(c); setText(''); setQ(''); };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label={label}>
        <span className="text-title-small text-on-surface-variant mr-1">{label}:</span>
        <Chip kind="filter" touch selected={!value} onClick={() => pick(null)}>{emptyLabel}</Chip>
        {value && <Chip kind="filter" touch selected onClick={() => pick(null)} aria-label={`${value.name} — tap to clear`}>{value.name}</Chip>}
      </div>
      <TextField label="Find a customer (name or phone)" leadingIcon="search" value={text} autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        supportingText={q.length >= 2 && res.data && !res.loading && matches.length === 0 ? 'No match — leave it on Walk-in or add them in Customers.' : undefined}
        error={res.error} />
      {matches.length > 0 && (
        <List label="Matching customers" className="py-0 mt-1 rounded-shape-small border border-outline-variant">
          {matches.map((c) => (
            <ListItem key={c.id} headline={c.name} supportingText={c.phone ?? undefined}
              onClick={() => pick({ id: c.id, name: c.name, phone: c.phone })} />
          ))}
        </List>
      )}
    </div>
  );
}
