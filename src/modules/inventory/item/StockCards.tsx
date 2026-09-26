// Per-location balances and cost history for one item.
import { Card, CardHeader, EmptyState, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { formatCents, formatDate } from '../../../lib/format';
import type { InventoryItem } from '../../../lib/types';
import type { Balance, CostRow } from '../types';

function Loading({ on, label }: { on: boolean; label: string }) {
  return <div className="h-1 -mt-1 mb-2">{on && <LinearProgress label={label} />}</div>;
}
function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <EmptyState tone="error" icon="warning" title="Couldn’t load"
      action={<button type="button" className="text-primary text-label-large underline" onClick={onRetry}>Try again</button>}>{error}</EmptyState>
  );
}

export function BalancesCard({ item }: { item: InventoryItem }) {
  const q = useQuery<Balance[]>(`/api/inventory/${item.id}/balances`);
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader title="By location" subtitle={`${item.count} ${item.countUnit ?? ''} in total`.trim()} />
      <Loading on={q.loading} label="Loading balances" />
      {q.error ? <Failed error={q.error} onRetry={q.reload} /> : q.data && rows.length === 0
        ? <p className="text-body-medium text-on-surface-variant">No stock recorded at any location yet.</p>
        : (
          <ul className="divide-y divide-outline-variant">
            {rows.map((b) => (
              <li key={b.locationId} className="flex justify-between py-2 text-body-large">
                <span>{b.locationName}</span><span className="tabular-nums">{b.onHand}</span>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

export function CostCard({ item }: { item: InventoryItem }) {
  const q = useQuery<CostRow[]>(`/api/inventory/${item.id}/cost-history`);
  const rows = [...(q.data ?? [])].reverse(); // newest first
  const avg = item.avgCostCents ?? 0;
  return (
    <Card>
      <CardHeader title="Cost"
        subtitle={avg ? `Average ${formatCents(avg)} per ${item.countUnit || 'unit'} · value ${formatCents(Math.max(item.count, 0) * avg)}` : 'No average cost yet — receive with a cost to set one.'} />
      {item.lastCostCents != null && (
        <p className="text-body-medium text-on-surface-variant mb-2">Last paid {formatCents(item.lastCostCents)} per {item.purchaseUnit || 'unit'}</p>
      )}
      <Loading on={q.loading} label="Loading cost history" />
      {q.error ? <Failed error={q.error} onRetry={q.reload} /> : q.data && rows.length === 0
        ? <p className="text-body-medium text-on-surface-variant">No costed receipts yet.</p>
        : rows.length > 0 && (
          <table className="w-full text-body-medium">
            <caption className="sr-only">Cost paid per receipt</caption>
            <thead><tr className="text-on-surface-variant text-left">
              <th scope="col" className="font-normal py-1">Received</th>
              <th scope="col" className="font-normal py-1 text-right">Paid / {item.purchaseUnit || 'unit'}</th>
              <th scope="col" className="font-normal py-1 text-right">Qty</th>
              <th scope="col" className="font-normal py-1 pl-3">Supplier</th>
            </tr></thead>
            <tbody>
              {rows.slice(0, 12).map((c, i) => (
                <tr key={i} className="border-t border-outline-variant">
                  <td className="py-1.5">{formatDate(c.createdAt)}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.unitCostCents != null ? formatCents(c.unitCostCents) : '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.delta}</td>
                  <td className="py-1.5 pl-3 text-on-surface-variant">{c.supplierName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Card>
  );
}
