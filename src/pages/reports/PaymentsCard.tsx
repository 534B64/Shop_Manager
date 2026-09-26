import type { DateRange } from '../../components/DateRangeFields';
import { useQuery, withParams } from '../../lib/query';
import { formatCents } from '../../lib/format';
import { METHOD_LABELS } from './logic';
import ReportCard, { Figures } from './ReportCard';

interface Summary { count: number; paymentsCents: number; refundsCents: number; netCents: number; byMethod: Record<string, number> }

/** Money in and out (voided rows excluded) — GET /api/reports/summary. */
export default function PaymentsCard({ range }: { range: DateRange }) {
  const q = useQuery<Summary>(withParams('/api/reports/summary', { from: range.from, to: range.to }));
  const s = q.data;
  return (
    <ReportCard title="Payments" subtitle="Money taken and refunded in the range. Voided rows don’t count."
      loading={q.loading} error={q.error} onRetry={q.reload}>
      {s && <>
        <Figures rows={[
          ['Payments', formatCents(s.paymentsCents)],
          ['Refunds', `−${formatCents(s.refundsCents)}`],
          ['Net', formatCents(s.netCents), true],
          ['Rows', s.count.toLocaleString()],
        ]} />
        <h3 className="text-title-small mt-4 mb-1">Net by tender</h3>
        {Object.keys(s.byMethod).length === 0
          ? <p className="text-body-medium text-on-surface-variant">No payments in this range.</p>
          : <Figures rows={Object.entries(s.byMethod).sort((a, b) => b[1] - a[1])
              .map(([m, c]) => [METHOD_LABELS[m] ?? m, formatCents(c)])} />}
      </>}
    </ReportCard>
  );
}
