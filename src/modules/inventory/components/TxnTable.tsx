import { Link } from 'react-router-dom';
import { Button, DataTable, EmptyState, type Column } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import { reasonLabel, signed, txnLabel } from '../logic';
import type { Txn } from '../types';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Inventory transactions (ledger rows) with keyset "Load more". */
export default function TxnTable({ label, list, showItem, showCost, locationName }: {
  label: string;
  list: { rows: Txn[]; loading: boolean; error: string | null; hasMore: boolean; loadMore: () => void; reload: () => void };
  showItem?: boolean; showCost?: boolean;
  locationName?: (id: number) => string | null;
}) {
  const cols: Column<Txn>[] = [
    { key: 'when', header: 'When', render: (t) => <span className="whitespace-nowrap">{when(t.createdAt)}</span> },
    ...(showItem ? [{ key: 'item', header: 'Item', width: 'min-w-[10rem]', render: (t: Txn) => (
      <Link to={`/inventory/${t.itemId}`} className="text-primary underline-offset-2 hover:underline">{t.itemName ?? `#${t.itemId}`}</Link>
    ) }] : []),
    { key: 'type', header: 'Type', render: (t) => txnLabel(t.txnType) },
    { key: 'reason', header: 'Reason', render: (t) => reasonLabel(t.reason), hideOnNarrow: true },
    { key: 'delta', header: 'Change', align: 'right', render: (t) => (
      <span className="text-title-small tabular-nums" aria-label={`${t.delta > 0 ? 'added' : 'removed'} ${Math.abs(t.delta)}`}>
        {signed(t.delta)}{t.countUnit ? ` ${t.countUnit}` : ''}
      </span>
    ) },
    { key: 'loc', header: 'Location', hideOnNarrow: true, render: (t) => t.locationName ?? locationName?.(t.locationId) ?? '—' },
    { key: 'by', header: 'By', hideOnNarrow: true, render: (t) => t.createdBy ?? 'System' },
    ...(showCost ? [{ key: 'cost', header: 'Unit cost', align: 'right' as const, hideOnNarrow: true,
      render: (t: Txn) => (t.unitCostCents != null ? formatCents(t.unitCostCents) : '—') }] : []),
    { key: 'note', header: 'Note', render: (t) => <span className="text-on-surface-variant">{t.note ?? ''}</span> },
  ];
  return (
    <div>
      <DataTable label={label} columns={cols} rows={list.rows} rowKey={(t) => t.id}
        loading={list.loading} error={list.error} onRetry={list.reload}
        empty={<EmptyState icon="inbox" title="No transactions">Nothing matches — try a wider date range or another type.</EmptyState>} />
      {list.hasMore && !list.error && (
        <div className="flex justify-center mt-3">
          <Button variant="outlined" onClick={list.loadMore} disabled={list.loading}>{list.loading ? 'Loading…' : 'Load more'}</Button>
        </div>
      )}
    </div>
  );
}
