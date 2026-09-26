import { useMemo } from 'react';
import { List, ListItem, EmptyState, cx } from '../../components/m3';
import { useQuery } from '../../lib/query';
import { formatDate } from '../../lib/format';
import type { Job } from '../../lib/types';
import DashCard from './DashCard';
import { dueSoon, splitTags, tagColor, type DueState } from './logic';

const SHOW = 6;
const DUE_TEXT: Record<DueState, string> = { overdue: 'text-error', today: 'text-warning', soon: 'text-on-surface-variant' };
const DUE_LABEL: Record<DueState, string> = { overdue: 'Overdue', today: 'Today', soon: '' };

export default function DueSoonCard() {
  const q = useQuery<Job[]>('/api/jobs?limit=200');
  const due = useMemo(() => dueSoon(q.data ?? [], new Date()), [q.data]);
  const overdue = due.filter((j) => j.due === 'overdue').length;
  return (
    <DashCard title="Due soon" to="/orders" openLabel="Open orders" loading={q.loading} error={q.error} onRetry={q.reload}
      subtitle={q.data && (due.length ? `${due.length} in the next 7 days${overdue ? ` · ${overdue} overdue` : ''}` : 'Next 7 days')}>
      {q.data && due.length === 0 && <EmptyState icon="check" title="Nothing due">Nothing due in the next 7 days.</EmptyState>}
      {due.length > 0 && (
        <List label="Jobs due soon" className="-mx-4 py-0">
          {due.slice(0, SHOW).map((j) => (
            <ListItem key={j.id} to="/orders"
              headline={j.title}
              supportingText={
                <span className="flex items-center gap-3 flex-wrap">
                  <span>{j.customerName ?? '—'}</span>
                  {splitTags(j.tags).map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 text-label-medium">
                      <span className="h-2 w-2 rounded-shape-full" style={{ background: tagColor(t) }} aria-hidden />{t}
                    </span>
                  ))}
                </span>
              }
              trailing={
                <span className={cx('text-right', DUE_TEXT[j.due])}>
                  <span className="block">{formatDate(j.dueDate)}</span>
                  {DUE_LABEL[j.due] && <span className="block text-label-small font-bold">{DUE_LABEL[j.due]}</span>}
                </span>
              } />
          ))}
        </List>
      )}
      {due.length > SHOW && <p className="text-body-medium text-on-surface-variant mt-2">+{due.length - SHOW} more on the Orders board</p>}
    </DashCard>
  );
}
