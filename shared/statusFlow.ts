// Order lifecycle rules. Simple path by default; proof path when useProofFlow.
import { SIMPLE_STATUSES, PROOF_STATUSES, type JobStatus } from './domain';

export function pathFor(useProofFlow: boolean): readonly JobStatus[] {
  return useProofFlow ? PROOF_STATUSES : SIMPLE_STATUSES;
}

/** Next status in the path, or null at the end. */
export function nextStatus(current: JobStatus, useProofFlow: boolean): JobStatus | null {
  const path = pathFor(useProofFlow);
  const i = path.indexOf(current);
  if (i === -1 || i === path.length - 1) return null;
  return path[i + 1];
}

/** Previous status in the path, or null at the start. */
export function prevStatus(current: JobStatus, useProofFlow: boolean): JobStatus | null {
  const path = pathFor(useProofFlow);
  const i = path.indexOf(current);
  if (i <= 0) return null;
  return path[i - 1];
}

/** Allowed: one step forward or one step back along the job's own path. */
export function canTransition(from: JobStatus, to: JobStatus, useProofFlow: boolean): boolean {
  return nextStatus(from, useProofFlow) === to || prevStatus(from, useProofFlow) === to;
}
