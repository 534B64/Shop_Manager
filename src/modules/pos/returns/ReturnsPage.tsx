// /pos/returns — every return, newest first (keyset paged, date filter in the URL).
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, DataTable, EmptyState, TextField, type Column } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import PosHeader from '../PosHeader';
import KeysetPager from '../../../components/KeysetPager';
import { formatWhen } from '../lib/when';
import { methodLabel, type ReturnRow } from '../types';
import { useKeyset } from '../../../lib/keysetPaging';

const COLS: Column<ReturnRow>[] = [
  { key: 'id', header: 'Return', width: 'w-24', render: (r) => (
    <Link className="text-primary underline" to={`/pos/returns/${r.id}`} onClick={(e) => e.stopPropagation()}>#{r.id}</Link>) },
  { key: 'createdAt', header: 'Date', render: (r) => formatWhen(r.createdAt) },
  { key: 'invoice', header: 'Invoice', render: (r) => <span className="tabular-nums">{r.invoiceNumber}</span> },
  { key: 'reason', header: 'Reason', render: (r) => r.reason, hideOnNarrow: true },
  { key: 'total', header: 'Value', align: 'right', render: (r) => <span className="tabular-nums">{formatCents(r.totalCents)}</span> },
  { key: 'refund', header: 'Money back', align: 'right', render: (r) => (r.refundCents > 0 ? `${formatCents(r.refundCents)} ${methodLabel(r.refundMethod)}` : 'none') },
];

export default function ReturnsPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const list = useKeyset<ReturnRow>('/api/returns', { from: sp.get('from') ?? '', to: sp.get('to') ?? '' }, 25);
  return (
    <div>
      <PosHeader title="Returns" subtitle="Goods that came back against an invoice." action={<Button touch icon="add" to="/pos/returns/new">New return</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 max-w-lg mb-4">
        <TextField label="From" type="date" value={sp.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} />
        <TextField label="To" type="date" value={sp.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} />
      </div>
      <DataTable label="Returns" columns={COLS} rows={list.rows} rowKey={(r) => r.id}
        loading={list.loading} error={list.error} onRetry={list.reload}
        empty={<EmptyState title="No returns">Start one from an invoice, or with New return.</EmptyState>}
        onRowClick={(r) => nav(`/pos/returns/${r.id}`)} />
      {(list.hasPrev || list.hasNext) && <KeysetPager paging={list} touch />}
    </div>
  );
}
