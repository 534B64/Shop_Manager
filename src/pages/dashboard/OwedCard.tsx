import { List, ListItem, EmptyState } from '../../components/m3';
import { useQuery } from '../../lib/query';
import { formatCents } from '../../lib/format';
import DashCard from './DashCard';

interface Balance { jobId: number; title: string; customerName: string | null; owedCents: number }
const SHOW = 5;

export default function OwedCard() {
  const q = useQuery<Balance[]>('/api/balances');
  const rows = q.data ?? [];
  const total = rows.reduce((s, b) => s + b.owedCents, 0);
  return (
    <DashCard title="Owed" to="/payments" openLabel="Open payments" loading={q.loading} error={q.error} onRetry={q.reload}
      subtitle={q.data && (rows.length ? `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'} with a balance` : undefined)}>
      {q.data && (
        <p className="text-display-small mb-2" aria-label={`Total owed ${formatCents(total)}`}>{formatCents(total)}</p>
      )}
      {q.data && rows.length === 0 && <EmptyState icon="check" title="All paid up" />}
      {rows.length > 0 && (
        <List label="Largest balances" className="-mx-4 py-0">
          {[...rows].sort((a, b) => b.owedCents - a.owedCents).slice(0, SHOW).map((b) => (
            <ListItem key={b.jobId} to="/payments" headline={b.title} supportingText={b.customerName ?? '—'}
              trailing={<span className="text-title-medium text-on-surface">{formatCents(b.owedCents)}</span>} />
          ))}
        </List>
      )}
    </DashCard>
  );
}
