// One job on the board: title (opens it), customer · PO, due, total, one-step moves.
import { Link } from 'react-router-dom';
import { Button, IconButton, cx } from '../../../components/m3';
import { formatCents, formatDate } from '../../../lib/format';
import type { Job } from '../../../lib/types';
import { STATUS_LABELS } from '../../../../shared/domain';
import { dueTone, jobMoves, type DueTone } from '../shared/jobLogic';
import type { useMoveJob } from '../shared/useMoveJob';
import { jobTotal } from '../types';

const DUE_TEXT: Record<DueTone, string> = {
  overdue: 'text-error font-semibold', today: 'text-warning font-semibold', soon: 'text-warning',
  later: 'text-on-surface-variant', none: 'text-on-surface-variant',
};
const DUE_WORD: Partial<Record<DueTone, string>> = { overdue: ' · overdue', today: ' · today' };

export default function JobCard({ job, mover, now }: { job: Job; mover: ReturnType<typeof useMoveJob>; now: Date }) {
  const done = job.status === 'picked_up';
  const { back, forward } = jobMoves(job);
  const total = jobTotal(job);
  const tone = done ? 'none' : dueTone(job.dueDate, now);
  const busy = mover.busyId === job.id;
  return (
    <li className={cx('rounded-shape-small border border-outline-variant bg-surface p-3 list-none', busy && 'opacity-60')}>
      <Link to={`/quotes/${job.id}`} className="block text-title-small hover:underline">{job.title}</Link>
      <p className="text-body-medium text-on-surface-variant truncate">{job.customerName ?? '—'}{job.po ? ` · ${job.po}` : ''}</p>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <span className={cx('text-body-medium', DUE_TEXT[tone])}>
          {done ? 'picked up' : `due ${formatDate(job.dueDate)}${DUE_WORD[tone] ?? ''}`}
        </span>
        <span className="text-title-small">{total != null ? formatCents(total) : '—'}</span>
      </div>
      {!done && (back || forward) && (
        <div className="flex items-center gap-1 mt-2">
          {back && <IconButton icon="chevronLeft" label={`Move ${job.title} back to ${STATUS_LABELS[back]}`} disabled={busy}
            onClick={() => mover.move(job, back)} />}
          {forward && (
            <Button variant="tonal" className="flex-1 !px-3" disabled={busy} onClick={() => mover.move(job, forward.to, forward.convert)}>
              {forward.label} →
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
