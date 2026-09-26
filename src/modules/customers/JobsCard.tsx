import { Button, Card, CardHeader, EmptyState, List, ListItem } from '../../components/m3';
import { STATUS_LABELS } from '../../../shared/domain';
import { formatCents, formatDate } from '../../lib/format';
import type { Job } from '../../lib/types';

const status = (s: string) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;

/** Job history (latest 100), each opening its quote/order. */
export default function JobsCard({ jobs, onPrint }: { jobs: Job[]; onPrint: () => void }) {
  return (
    <Card padded={false} className="pt-4">
      <div className="px-4">
        <CardHeader title={`Jobs (${jobs.length})`}
          action={<Button variant="text" onClick={onPrint} disabled={jobs.length === 0}>Print history</Button>} />
      </div>
      {jobs.length === 0 ? <EmptyState title="No jobs yet" /> : (
        <List label="Jobs" className="py-0">
          {jobs.map((j) => (
            <ListItem key={j.id} to={`/quotes/${j.id}`} headline={j.title}
              supportingText={`${j.po ? `PO ${j.po} · ` : ''}${status(j.status)} · ${formatDate(j.createdAt)}`}
              trailing={<span className="text-title-small text-on-surface">{j.finalPriceCents != null ? formatCents(j.finalPriceCents) : '—'}</span>} />
          ))}
        </List>
      )}
      {jobs.length >= 100 && <p className="px-4 pb-3 text-body-small text-on-surface-variant">Showing the latest 100 jobs.</p>}
    </Card>
  );
}
