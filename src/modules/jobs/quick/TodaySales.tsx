// Today's counter payments (from the newest 100 payment rows).
import { EmptyState, LinearProgress, List, ListItem, Card, CardHeader } from '../../../components/m3';
import type { QueryState } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import { localIsoDate } from '../shared/jobLogic';

export interface PaymentRow { id: number; amountCents: number; method: string; kind: string; voidedAt: string | null; createdAt: string; jobTitle: string | null }

export default function TodaySales({ q }: { q: QueryState<PaymentRow[]> }) {
  const today = localIsoDate(new Date());
  const rows = (q.data ?? []).filter((p) => localIsoDate(new Date(p.createdAt)) === today && !p.voidedAt && p.kind === 'payment');
  const total = rows.reduce((s, p) => s + p.amountCents, 0);
  return (
    <Card variant="outlined" padded={false} className="pt-4" aria-labelledby="today-h">
      <div className="px-4"><CardHeader id="today-h" title={`Today (${rows.length})`} subtitle={rows.length ? `${formatCents(total)} taken` : undefined} /></div>
      <div className="h-1">{q.loading && <LinearProgress label="Loading today’s sales" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load">{q.error}</EmptyState>}
      {q.data && rows.length === 0 && <EmptyState title="No sales yet today" />}
      <List label="Today’s payments" className="py-0">
        {rows.slice(0, 12).map((p) => (
          <ListItem key={p.id} headline={p.jobTitle ?? '—'} supportingText={p.method}
            trailing={<span className="text-title-medium text-on-surface">{formatCents(p.amountCents)}</span>} />
        ))}
      </List>
    </Card>
  );
}
