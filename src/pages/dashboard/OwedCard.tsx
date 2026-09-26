import { List, ListItem, EmptyState } from '../../components/m3';
import { useQuery } from '../../lib/query';
import { formatCents } from '../../lib/format';
import DashCard from './DashCard';

interface Balance { jobId: number; title: string; customerName: string | null; owedCents: number }
interface Owed { rows: Balance[]; total: number; totalOwedCents: number }
const SHOW = 5;

export default function OwedCard() {
  // Largest balances first, plus the count and the sum — computed in SQL.
  const q = useQuery<Owed>(`/api/balances?limit=${SHOW}`);
  const rows = q.data?.rows ?? [];
  const count = q.data?.total ?? 0;
  const total = q.data?.totalOwedCents ?? 0;
  return (
    <DashCard title="Owed" to="/payments" openLabel="Open payments" loading={q.loading} error={q.error} onRetry={q.reload}
      subtitle={q.data && (count ? `${count} ${count === 1 ? 'job' : 'jobs'} with a balance` : undefined)}>
      {q.data && (
        <p className="text-display-small mb-2" aria-label={`Total owed ${formatCents(total)}`}>{formatCents(total)}</p>
      )}
      {q.data && rows.length === 0 && <EmptyState icon="check" title="All paid up" />}
      {rows.length > 0 && (
        <List label="Largest balances" className="-mx-4 py-0">
          {rows.map((b) => (
            <ListItem key={b.jobId} to="/payments" headline={b.title} supportingText={b.customerName ?? '—'}
              trailing={<span className="text-title-medium text-on-surface">{formatCents(b.owedCents)}</span>} />
          ))}
        </List>
      )}
    </DashCard>
  );
}
