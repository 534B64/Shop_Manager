import { useQuery } from '../../lib/query';
import { formatCents } from '../../lib/format';
import ReportCard, { Figures } from './ReportCard';

interface Valuation { totalCents: number; pricedItems: number; unpricedItems: number; byCategory: { name: string; valueCents: number; items: number }[] }

/** Cash tied up on the shelf right now (on-hand × average cost, ADR 0006). */
export default function ValuationCard() {
  const q = useQuery<Valuation>('/api/inventory/valuation');
  const v = q.data;
  return (
    <ReportCard title="Inventory value (today)" subtitle="On-hand × average cost. Not affected by the date range."
      loading={q.loading} error={q.error} onRetry={q.reload}>
      {v && <>
        <p className="text-display-small mb-2">{formatCents(v.totalCents)}</p>
        <p className="text-body-medium text-on-surface-variant mb-3">
          {v.pricedItems.toLocaleString()} items with a cost{v.unpricedItems ? ` · ${v.unpricedItems.toLocaleString()} without one (left out)` : ''}
        </p>
        {v.byCategory.length > 0 && <Figures rows={v.byCategory.map((c) => [`${c.name} (${c.items})`, formatCents(c.valueCents)])} />}
      </>}
    </ReportCard>
  );
}
