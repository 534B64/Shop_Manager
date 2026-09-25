// Min/Max reorder math — pure logic shared by the AUTO-Min button (client)
// and the needs-ordering view (server). No statistical safety stock (z-scores
// etc.) by decision — lead time × average usage plus a flat buffer is enough
// for a shop this size.

export const DEFAULT_REORDER_BUFFER_DAYS = 3;

/**
 * Average daily usage over a window between two physical counts:
 *   (baseline counted + receipts since − new counted) / days elapsed.
 * The two counts are ground truth; everything that left in between —
 * tracked sales, manual taps, untracked production use, waste — is captured
 * by the difference, which is exactly why the weekly count is the reconciler.
 * Returns null when the window is too short to mean anything (< half a day),
 * and clamps negative usage (counted more than explainable) to 0.
 */
export function avgDailyUse(opts: {
  baselineCounted: number;
  inflowsSince: number; // sum of positive non-count adjustments in the window
  newCounted: number;
  days: number;
}): number | null {
  if (opts.days < 0.5) return null;
  const used = Math.max(0, opts.baselineCounted + opts.inflowsSince - opts.newCounted);
  return used / opts.days;
}

/**
 * Suggested reorder point (Min): enough to cover expected usage while the
 * restock is on the way, plus a buffer. Null when there's no usage history
 * yet — a suggestion invented from nothing would be worse than no suggestion.
 */
export function suggestedMin(
  avgDaily: number | null | undefined,
  leadTimeDays: number,
  bufferDays: number,
): number | null {
  if (avgDaily == null || avgDaily <= 0) return null;
  return Math.ceil(avgDaily * (leadTimeDays + bufferDays));
}

/** Days of stock left at the current usage rate. Null without a usage rate. */
export function daysUntilStockout(count: number, avgDaily: number | null | undefined): number | null {
  if (avgDaily == null || avgDaily <= 0) return null;
  return count / avgDaily;
}

export interface ReorderRow {
  count: number;
  lowStockThreshold: number; // Min
  avgDailyUse?: number | null;
}

/**
 * Urgency order for the needs-ordering view: fewest days-until-stockout first;
 * rows without a usage rate fall back to how far below Min they sit (deepest
 * first); ties break on that same depth.
 */
export function urgencyCompare(a: ReorderRow, b: ReorderRow): number {
  const da = daysUntilStockout(a.count, a.avgDailyUse);
  const db = daysUntilStockout(b.count, b.avgDailyUse);
  if (da != null && db != null && da !== db) return da - db;
  if ((da == null) !== (db == null)) return da == null ? 1 : -1;
  return (b.lowStockThreshold - b.count) - (a.lowStockThreshold - a.count);
}
