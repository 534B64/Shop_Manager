// /inventory/reorder — what needs ordering (most urgent first) and the usage
// rates behind it. View, supplier filter and page live in the URL.
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Chip, DataTable, EmptyState, Icon, Select, type Column } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import InventoryHeader from '../components/InventoryHeader';
import { useSuppliers } from '../components/lookups';
import { useUrlPaged } from '../components/useUrlPaged';
import type { ReorderRow, UsageRow } from '../types';

const itemLink = (r: { id: number; name: string }) =>
  <Link to={`/inventory/${r.id}`} className="text-title-small text-on-surface hover:underline underline-offset-2">{r.name}</Link>;

function DaysLeft({ days }: { days: number | null }) {
  if (days == null) return <span className="text-on-surface-variant">No usage rate yet</span>;
  const soon = days <= 3;
  return (
    <span className={soon ? 'text-error inline-flex items-center gap-1' : 'inline-flex items-center gap-1'}>
      {soon && <Icon name="warning" size={16} />}~{Math.floor(days)} day{Math.floor(days) === 1 ? '' : 's'} left
    </span>
  );
}

const REORDER_COLS: Column<ReorderRow>[] = [
  { key: 'name', header: 'Item', render: itemLink },
  { key: 'days', header: 'Runs out', render: (r) => <DaysLeft days={r.daysUntilStockout} /> },
  { key: 'have', header: 'Have / Min', align: 'right', render: (r) => <span className="tabular-nums">{r.count} / {r.threshold}</span> },
  { key: 'order', header: 'Order', align: 'right', render: (r) => (
    <span className="text-title-small tabular-nums">{r.suggestedQty} {r.countUnit ?? ''}
      {r.reorderMaxQty != null && <span className="block text-body-small text-on-surface-variant">up to Max {r.reorderMaxQty}</span>}</span>
  ) },
  { key: 'supplier', header: 'Supplier', hideOnNarrow: true,
    render: (r) => `${r.supplierName ?? 'No supplier'}${r.leadTimeDays != null ? ` · ${r.leadTimeDays}d lead` : ''}` },
  { key: 'cost', header: 'Last cost', align: 'right', hideOnNarrow: true,
    render: (r) => (r.lastCostCents != null ? `${formatCents(r.lastCostCents)}${r.purchaseUnit ? ` / ${r.purchaseUnit}` : ''}` : '—') },
];

const USAGE_COLS: Column<UsageRow>[] = [
  { key: 'name', header: 'Item', render: itemLink },
  { key: 'rate', header: 'Usage', align: 'right', render: (u) => (u.avgDailyUse != null
    ? <span className="tabular-nums">~{Number(u.avgDailyUse.toFixed(2))}/day</span>
    : <span className="text-on-surface-variant">No rate yet</span>) },
  { key: 'have', header: 'On hand', align: 'right', render: (u) => <span className="tabular-nums">{u.count} {u.countUnit ?? ''}</span> },
  { key: 'days', header: 'Runs out', render: (u) => <DaysLeft days={u.daysUntilStockout} /> },
];

export default function Reorder() {
  const [sp, setSp] = useSearchParams();
  const usage = sp.get('view') === 'usage';
  const supplierId = sp.get('supplierId') ?? '';
  const page = Math.max(0, (Number(sp.get('page')) || 1) - 1);
  const set = (patch: Record<string, string>) => setSp((cur) => {
    const n = new URLSearchParams(cur);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    if (!('page' in patch)) n.delete('page');
    return n;
  });
  const setPage = (p: number) => set({ page: p > 0 ? String(p + 1) : '' });
  const sups = useSuppliers();
  const reorder = useUrlPaged<ReorderRow>(usage ? '/api/inventory/usage' : '/api/inventory/reorder', { supplierId }, page, setPage, { pageSize: 50 });

  return (
    <div>
      <InventoryHeader title="Reorder" subtitle={usage
        ? 'Average use per day comes from count to count (plus receipts), so untracked use and waste are included. Items need two counts before a rate shows.'
        : 'Everything at or below its Min, most urgent first. Order fills back up to Max when one is set.'}
        actions={!usage && <Button variant="outlined" onClick={() => window.print()}>Print</Button>} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2" role="group" aria-label="View">
          <Chip kind="filter" selected={!usage} onClick={() => set({ view: '' })}>Needs ordering</Chip>
          <Chip kind="filter" selected={usage} onClick={() => set({ view: 'usage' })}>Usage</Chip>
        </div>
        <Select className="w-64" label="Supplier" value={supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
          <option value="">All suppliers</option>
          {sups.live.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      {usage ? (
        <DataTable label="Usage by item" columns={USAGE_COLS} rows={reorder.rows as unknown as UsageRow[]} rowKey={(r) => r.id}
          loading={reorder.loading} error={reorder.error} onRetry={reorder.reload} paging={reorder}
          empty={<EmptyState title="No items">Nothing to show for this supplier.</EmptyState>} />
      ) : (
        <DataTable label="Items that need ordering" columns={REORDER_COLS} rows={reorder.rows} rowKey={(r) => r.id}
          loading={reorder.loading} error={reorder.error} onRetry={reorder.reload} paging={reorder}
          empty={<EmptyState icon="check" title="Nothing below Min">Every item is above its reorder point.</EmptyState>} />
      )}
    </div>
  );
}
