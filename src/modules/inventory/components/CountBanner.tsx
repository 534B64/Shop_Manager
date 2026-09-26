import { Button, Icon, cx } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { formatDate } from '../../../lib/format';
import type { CycleCount } from '../types';

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** What the open cycle count needs, if anything: due, sent back, or awaiting approval. */
export default function CountBanner({ quietWhenNotDue }: { quietWhenNotDue?: boolean }) {
  const cc = useQuery<CycleCount | null>('/api/cycle-counts/next').data;
  if (!cc) return null;
  const sentBack = cc.status === 'counting' && cc.notes?.startsWith('Sent back');
  const due = cc.status === 'counting' && cc.scheduledFor <= todayIso();
  if (quietWhenNotDue && cc.status === 'counting' && !due && !sentBack) return null;
  const urgent = due || sentBack || cc.status === 'submitted';
  const [title, body, action] = cc.status === 'submitted'
    ? ['Cycle count awaiting manager approval', `Counted by ${cc.submittedBy ?? 'someone'}. On-hand changes when a manager posts it.`, 'Review']
    : sentBack ? ['Cycle count needs a recount', cc.notes ?? '', 'Recount']
    : due ? ['Cycle count due', `Scheduled for ${formatDate(cc.scheduledFor)}.`, 'Start count']
    : ['Next cycle count', `Scheduled for ${formatDate(cc.scheduledFor)}.`, 'Start early'];
  return (
    <div role="status" className={cx('flex flex-wrap items-center gap-3 rounded-shape-medium px-4 py-3 mb-4',
      urgent ? 'bg-warning-container text-on-warning-container' : 'bg-secondary-container text-on-secondary-container')}>
      <Icon name={urgent ? 'warning' : 'info'} />
      <div className="flex-1 min-w-0">
        <p className="text-title-small">{title}</p>
        {body && <p className="text-body-medium">{body}</p>}
      </div>
      <Button to={`/inventory/counts/${cc.id}`}>{action}</Button>
    </div>
  );
}
