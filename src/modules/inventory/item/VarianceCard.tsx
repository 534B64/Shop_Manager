import { Card, CardHeader, Icon, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { formatCents, formatDate } from '../../../lib/format';
import { reasonLabel, signed } from '../logic';
import type { VarianceRow } from '../types';

/** Posted cycle-count results for one item, with the repeated-variance warning. */
export default function VarianceCard({ itemId }: { itemId: number }) {
  const q = useQuery<{ rows: VarianceRow[]; repeated: boolean }>(`/api/inventory/${itemId}/variances`);
  const rows = q.data?.rows ?? [];
  return (
    <Card>
      <CardHeader title="Count history" subtitle="What each posted cycle count found against what the system expected" />
      <div className="h-1 -mt-1 mb-2">{q.loading && <LinearProgress label="Loading count history" />}</div>
      {q.data?.repeated && (
        <div role="alert" className="flex gap-3 items-start rounded-shape-small bg-warning-container text-on-warning-container px-4 py-3 mb-3">
          <Icon name="warning" className="shrink-0" />
          <p className="text-body-medium">
            <strong>Repeated count variance</strong> — 3 or more of the last 4 counts were off. Check the unit conversion,
            how it’s being counted, or whether the supplier is shorting orders.
          </p>
        </div>
      )}
      {q.error && <p role="alert" className="text-body-medium text-error">{q.error} <button type="button" className="underline" onClick={q.reload}>Try again</button></p>}
      {q.data && rows.length === 0 && <p className="text-body-medium text-on-surface-variant">Not counted in a posted cycle count yet.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body-medium">
            <caption className="sr-only">Count variances, newest first</caption>
            <thead><tr className="text-on-surface-variant text-left">
              <th scope="col" className="font-normal py-1">Counted</th>
              <th scope="col" className="font-normal py-1 text-right">System → shelf</th>
              <th scope="col" className="font-normal py-1 text-right">Variance</th>
              <th scope="col" className="font-normal py-1 text-right">Impact</th>
              <th scope="col" className="font-normal py-1 pl-3">Reason</th>
            </tr></thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={i} className="border-t border-outline-variant align-top">
                  <td className="py-1.5 whitespace-nowrap">{formatDate(v.createdAt)}</td>
                  <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{v.systemCount} → {v.counted}</td>
                  <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                    {v.delta === 0 ? 'None' : <>{signed(v.delta)}{v.pct != null && ` (${signed(Math.round(v.pct))}%)`}</>}
                    {v.aboveThreshold && <span className="text-warning inline-flex align-middle ml-1"><Icon name="warning" size={14} title="Above threshold" /></span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{v.impactCents != null && v.delta !== 0 ? formatCents(v.impactCents) : '—'}</td>
                  <td className="py-1.5 pl-3 text-on-surface-variant">{[v.reasonCode && reasonLabel(v.reasonCode), v.note].filter(Boolean).join(' — ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
