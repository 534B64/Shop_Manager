// /orders — the production queue. Board (lanes) or List (paged table);
// search and view live in the URL (?view=list&status=…&q=…).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Tabs, TextField } from '../../../components/m3';
import Board from './Board';
import JobList from './JobList';

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const [text, setText] = useState(q);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) update({ q: text.trim() }); }, 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <h1 className="text-headline-medium">Orders</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TextField label="Search title / PO / tag / customer" leadingIcon="search" value={text} className="w-72"
            onChange={(e) => setText(e.target.value)} />
          <Button to="/quotes/new" icon="add">New quote</Button>
        </div>
      </div>
      <Tabs label="Orders view" className="mb-4" value={view}
        items={[{ label: 'Board', value: 'board' }, { label: 'List', value: 'list' }]}
        onChange={(v) => update({ view: v === 'list' ? 'list' : '', status: '' })} />
      {view === 'board'
        ? <Board q={q} onSeeAll={(s) => update({ view: 'list', status: s })} />
        : <JobList q={q} status={status} onStatus={(s) => update({ status: s })} />}
    </div>
  );
}
