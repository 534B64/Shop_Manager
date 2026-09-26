import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import type { Valuation } from '../types';

/** "On-hand value $X across N priced items" — cash on the shelf at average cost. */
export default function ValuationSummary() {
  const q = useQuery<Valuation>('/api/inventory/valuation');
  const v = q.data;
  if (q.error) return <span>Every change is logged with a reason. (On-hand value unavailable right now.)</span>;
  if (!v) return <span>Every change is logged with a reason.</span>;
  if (v.pricedItems === 0) return <span>Every change is logged with a reason. No item has a cost yet, so there’s no on-hand value.</span>;
  return (
    <span>
      On-hand value <strong className="text-on-surface">{formatCents(v.totalCents)}</strong> across {v.pricedItems} priced
      item{v.pricedItems === 1 ? '' : 's'}
      {v.unpricedItems > 0 && ` (${v.unpricedItems} without a cost)`}
      {v.byCategory.length > 1 && (
        <span className="block text-body-small">
          {v.byCategory.slice(0, 4).map((c) => `${c.name} ${formatCents(c.valueCents)}`).join(' · ')}
          {v.byCategory.length > 4 ? ' · …' : ''}
        </span>
      )}
    </span>
  );
}
