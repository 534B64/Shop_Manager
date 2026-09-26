// /customers — server-paged, searchable list. Search, "Show archived" and
// sort live in the URL so back/bookmarks keep them.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Checkbox, DataTable, Select, TextField, type Column } from '../../components/m3';
import { usePaged } from '../../lib/query';
import { formatDate } from '../../lib/format';
import type { Customer } from '../../lib/types';
import { isInactive } from './logic';
import CustomerFormDialog from './CustomerFormDialog';

const SORTS = { recent: 'Recent activity', name: 'Name', created: 'Newest customers' } as const;

export default function CustomerList() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const q = sp.get('q') ?? '';
  const archived = sp.get('archived') === '1';
  const sort = (sp.get('sort') ?? 'recent') as keyof typeof SORTS;
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState(false);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setSp(next, { replace: true });
  };
  // Debounce typing into the URL (and so into the request).
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) update({ q: text.trim() }); }, 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = usePaged<Customer>('/api/customers', { q, includeArchived: archived, sort: sort === 'recent' ? '' : sort });

  const cols: Column<Customer>[] = [
    { key: 'name', header: 'Name', render: (c) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link to={`/customers/${c.id}`} className="text-title-small text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
        {c.archivedAt ? <Badge tone="neutral" className="!h-5 px-2">Archived</Badge>
          : isInactive(c.lastJobAt) && <Badge tone="neutral" className="!h-5 px-2">Inactive</Badge>}
        {c.level > 0 && <Badge tone="primary" className="!h-5 px-2">Level {c.level}</Badge>}
      </span>
    ) },
    { key: 'phone', header: 'Phone', render: (c) => c.phone || '—', hideOnNarrow: true },
    { key: 'email', header: 'Email', render: (c) => c.email || '—', hideOnNarrow: true },
    { key: 'last', header: 'Last purchase', align: 'right', render: (c) => (c.lastJobAt ? formatDate(c.lastJobAt) : 'Never') },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-headline-medium">Customers</h1>
          <p className="text-body-medium text-on-surface-variant">Search by name, email, or phone. Open a customer for their account.</p>
        </div>
        <Button icon="add" onClick={() => setAdding(true)}>New customer</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <TextField label="Search customers" leadingIcon="search" type="search" className="flex-1 min-w-60"
          value={text} onChange={(e) => setText(e.target.value)} />
        <Select label="Sort by" className="w-52" value={sort} onChange={(e) => update({ sort: e.target.value === 'recent' ? '' : e.target.value })}>
          {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Checkbox label="Show archived" checked={archived} onChange={(e) => update({ archived: e.target.checked ? '1' : '' })} />
      </div>
      <DataTable label="Customers" columns={cols} rows={list.rows} rowKey={(c) => c.id}
        loading={list.loading} error={list.error} onRetry={list.reload} paging={list}
        onRowClick={(c) => nav(`/customers/${c.id}`)}
        empty={<p className="p-6 text-center text-body-medium text-on-surface-variant">{q ? 'No customers match that search.' : 'No customers yet.'}</p>} />
      <CustomerFormDialog open={adding} onClose={() => setAdding(false)} onSaved={(c) => nav(`/customers/${c.id}`)} />
    </div>
  );
}
