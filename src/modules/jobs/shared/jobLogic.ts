// Pure job helpers shared by the board, the job page and the dashboard (tested in jobLogic.test.ts).
import { STATUS_LABELS, type JobStatus } from '../../../../shared/domain';
import { nextStatus, prevStatus } from '../../../../shared/statusFlow';

/** yyyy-mm-dd in the shop's local time (not UTC — a job due today stays "today" after 7pm). */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** How urgent a due date is: overdue, today, within 2 days, later, or no date. */
export function dueTone(dueDate: string | null, now: Date): DueTone {
  if (!dueDate) return 'none';
  const today = localIsoDate(now);
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return dueDate <= localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)) ? 'soon' : 'later';
}

export interface Forward { to: JobStatus; label: string; convert: boolean }

/**
 * The one-step moves a job has. A quote moves forward by converting (proof
 * jobs → Approved, simple jobs → Acknowledged); everything else follows its path.
 */
export function jobMoves(j: { status: string; useProofFlow: boolean }): { back: JobStatus | null; forward: Forward | null } {
  const s = j.status as JobStatus;
  if (s === 'quote') {
    const to: JobStatus = j.useProofFlow ? 'approved' : 'acknowledged';
    return { back: null, forward: { to, label: j.useProofFlow ? 'Approve' : 'Convert to order', convert: true } };
  }
  const next = nextStatus(s, j.useProofFlow);
  return {
    back: prevStatus(s, j.useProofFlow),
    forward: next ? { to: next, label: STATUS_LABELS[next], convert: false } : null,
  };
}

export const PROOF_LANES: JobStatus[] = ['quote', 'approved', 'design'];
export const MAIN_LANES: JobStatus[] = ['acknowledged', 'in_progress', 'done', 'picked_up'];

/** Board lanes to show: the proof lanes only while any job sits in one (all three, so a move is visible). */
export function visibleLanes(totals: Partial<Record<string, number>>): JobStatus[] {
  const proof = PROOF_LANES.some((s) => (totals[s] ?? 0) > 0);
  return [...(proof ? PROOF_LANES : []), ...MAIN_LANES];
}
