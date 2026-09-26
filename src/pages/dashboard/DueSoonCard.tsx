import { List, ListItem, EmptyState, cx } from '../../components/m3';
import { useQuery } from '../../lib/query';
import { formatDate } from '../../lib/format';
import type { Job } from '../../lib/types';
import DashCard from './DashCard';
import { dueState, localIsoDate, splitTags, tagColor, type DueState } from './logic';

interface DueSoon { rows: Job[]; total: number; overdue: number }

const SHOW = 6;
const DUE_TEXT: Record<DueState, string> = { overdue: 'text-error', today: 'text-warning', soon: 'text-on-surface-variant' };
const DUE_LABEL: Record<DueState, string> = { overdue: 'Overdue', today: 'Today', soon: '' };

export default function DueSoonCard() {
  const today = localIsoDate(new Date());
  // The server filters, sorts and counts; only the rows shown come down.
  const q = useQuery<DueSoon>(`/api/jobs/due-soon?days=7&limit=${SHOW}&today=${today}`);
  const due = (q.data?.rows ?? []).map((j) => ({ ...j, due: dueState(j.dueDate!, today) }));
  const total = q.data?.total ?? 0;
  const overdue = q.data?.overdue ?? 0;
  return (
    <DashCard title="Due soon" to="/orders" openLabel="Open orders" loading={q.loading} error={q.error} onRetry={q.reload}
      subtitle={q.data && (total ? `${total} in the next 7 days${overdue ? ` · ${overdue} overdue` : ''}` : 'Next 7 days')}>
      {q.data && total === 0 && <EmptyState icon="check" title="Nothing due">Nothing due in the next 7 days.</EmptyState>}
      {due.length > 0 && (
        <List label="Jobs due soon" className="-mx-4 py-0">
          {due.map((j) => (
            <ListItem key={j.id} to={`/quotes/${j.id}`}
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
      {total > SHOW && <p className="text-body-medium text-on-surface-variant mt-2">+{total - SHOW} more on the Orders board</p>}
    </DashCard>
  );
}
