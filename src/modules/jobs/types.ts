// Response shapes of the jobs endpoints this module reads.
import type { Job, JobItem } from '../../lib/types';

/** GET /api/jobs/:id — the job, its live lines, its invoice (if any) and balance. */
export interface JobDetail extends Job {
  customerLevel: number | null;
  items: JobItem[];
  /** Set once the job is invoiced: money fields are locked (ADR 0007). */
  invoice: { id: number; number: string } | null;
  owedCents: number;
}

/** GET /api/jobs/board — one lane per status, capped, with its full count. */
export interface BoardLane { status: string; rows: Job[]; total: number }
export interface Board { lanes: BoardLane[]; limit: number }

/** Server's non-blocking quote-math re-check (Phase 11). */
export interface PriceCheck { verified: boolean; serverTotalCents: number; clientTotalCents: number | null }

/** After-tax total when the server computed one; the pre-tax price otherwise. */
export const jobTotal = (j: Pick<Job, 'totalCents' | 'finalPriceCents'>): number | null =>
  j.totalCents ?? j.finalPriceCents ?? null;
