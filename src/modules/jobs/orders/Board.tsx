// The production board: one lane per status, each capped server-side with its
// full count — the board never downloads every job.
import { Button, EmptyState, LinearProgress, cx } from '../../../components/m3';
import { useQuery, withParams } from '../../../lib/query';
import { STATUS_LABELS, type JobStatus } from '../../../../shared/domain';
import { visibleLanes } from '../shared/jobLogic';
import { useMoveJob } from '../shared/useMoveJob';
import type { Board as BoardData } from '../types';
import JobCard from './JobCard';

const LANE_LIMIT = 20;
const TONES: Record<string, { header: string; border: string }> = {
  quote: { header: 'bg-secondary text-on-secondary', border: 'border-secondary' },
  approved: { header: 'bg-tertiary text-on-tertiary', border: 'border-tertiary' },
  design: { header: 'bg-tertiary-container text-on-tertiary-container', border: 'border-tertiary' },
  acknowledged: { header: 'bg-primary text-on-primary', border: 'border-primary' },
  in_progress: { header: 'bg-warning text-on-warning', border: 'border-warning' },
  done: { header: 'bg-success text-on-success', border: 'border-success' },
  picked_up: { header: 'bg-inverse-surface text-inverse-on-surface', border: 'border-inverse-surface' },
};

export default function Board({ q, onSeeAll }: { q: string; onSeeAll: (status: string) => void }) {
  const board = useQuery<BoardData>(withParams('/api/jobs/board', { q, limit: LANE_LIMIT }));
  const mover = useMoveJob(board.reload);
  const lanes = board.data?.lanes ?? [];
  const totals = Object.fromEntries(lanes.map((l) => [l.status, l.total]));
  const shown = visibleLanes(totals);
  const now = new Date();

  if (board.error && !board.data) {
    return <EmptyState tone="error" icon="warning" title="Couldn’t load the board"
      action={<Button variant="outlined" onClick={board.reload}>Try again</Button>}>{board.error}</EmptyState>;
  }
  return (
    <div>
      <div className="h-1 mb-2">{board.loading && <LinearProgress label="Loading the board" />}</div>
      {board.data && lanes.every((l) => l.total === 0) && (
        <EmptyState icon="inbox" title={q ? 'No jobs match' : 'No jobs yet'}
          action={<Button to="/quotes/new" icon="add">New quote</Button>}>{q ? `Nothing matches “${q}”.` : 'Quotes and orders show up here.'}</EmptyState>
      )}
      <div className="grid gap-3 pb-4 items-start overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(11rem, 1fr))` }}>
        {board.data && shown.map((status) => {
          const lane = lanes.find((l) => l.status === status) ?? { status, rows: [], total: 0 };
          const tone = TONES[status];
          const label = STATUS_LABELS[status as JobStatus];
          return (
            <section key={status} aria-label={`${label}: ${lane.total}`} className="min-w-0">
              <h2 className={cx('rounded-shape-small mb-2 px-3 py-2 text-title-small', tone.header)}>
                {label} <span className="font-normal">({lane.total})</span>
              </h2>
              <ol className={cx('flex flex-col gap-2 border-l-4 pl-2', tone.border)}>
                {lane.rows.map((j) => <JobCard key={j.id} job={j} mover={mover} now={now} />)}
                {lane.total === 0 && <li className="list-none text-body-medium text-on-surface-variant px-1 py-2">None</li>}
              </ol>
              {lane.total > lane.rows.length && (
                <Button variant="text" className="mt-1" onClick={() => onSeeAll(status)}>See all {lane.total}</Button>
              )}
            </section>
          );
        })}
      </div>
      {mover.dialog}
    </div>
  );
}
