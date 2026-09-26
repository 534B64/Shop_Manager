// Today's counter sales: the total from the SQL summary (every payment on the
// shop's local day — the server reads a plain date as a local day), the list
// from the newest 12.
import { EmptyState, LinearProgress, List, ListItem, Card, CardHeader } from '../../../components/m3';
import { useQuery, withParams, type Page } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import { localIsoDate } from '../shared/jobLogic';

export interface PaymentRow { id: number; amountCents: number; method: string; kind: string; voidedAt: string | null; createdAt: string; jobTitle: string | null }
interface Summary { paymentCount: number; paymentsCents: number }

export function useTodaySales() {
  const today = localIsoDate(new Date());
  const summary = useQuery<Summary>(withParams('/api/reports/summary', { from: today, to: today }));
  const recent = useQuery<Page<PaymentRow>>('/api/payments?limit=12&offset=0');
  return { summary, recent, reload: () => { summary.reload(); recent.reload(); } };
}

export default function TodaySales({ q }: { q: ReturnType<typeof useTodaySales> }) {
  const today = localIsoDate(new Date());
  const rows = (q.recent.data?.rows ?? []).filter((p) => localIsoDate(new Date(p.createdAt)) === today && !p.voidedAt && p.kind === 'payment');
  const s = q.summary.data;
  const loading = q.summary.loading || q.recent.loading;
  const error = q.summary.error ?? q.recent.error;
  return (
    <Card variant="outlined" padded={false} className="pt-4" aria-labelledby="today-h">
      <div className="px-4"><CardHeader id="today-h" title={`Today (${s?.paymentCount ?? rows.length})`}
        subtitle={s && s.paymentCount ? `${formatCents(s.paymentsCents)} taken` : undefined} /></div>
      <div className="h-1">{loading && <LinearProgress label="Loading today’s sales" />}</div>
      {error && <EmptyState tone="error" icon="warning" title="Couldn’t load">{error}</EmptyState>}
      {q.recent.data && rows.length === 0 && <EmptyState title="No sales yet today" />}
      <List label="Today’s latest payments" className="py-0">
        {rows.map((p) => (
          <ListItem key={p.id} headline={p.jobTitle ?? '—'} supportingText={p.method}
            trailing={<span className="text-title-medium text-on-surface">{formatCents(p.amountCents)}</span>} />
        ))}
      </List>
    </Card>
  );
}
