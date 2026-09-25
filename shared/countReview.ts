// Cycle-count variance review — pure logic shared by the review screen
// (client) and the submit validation (server), so the two can never disagree
// about which variances need a reason code.
//
// A variance is "above threshold" when it beats EITHER limit:
//   · |pct|   ≥ pctThreshold   (percent of the system count)
//   · |units| ≥ unitThreshold  (flat count-unit amount)
// A count that finds stock where the system said zero has no meaningful
// percentage (division by zero) — it always flags via the pct rule, since any
// find-from-zero is a 100%+ surprise.

export interface VarianceThresholds {
  pctThreshold: number; // e.g. 5 (= ±5%)
  unitThreshold: number; // e.g. 5 (= ±5 count units)
}

export const DEFAULT_VARIANCE_THRESHOLDS: VarianceThresholds = {
  pctThreshold: 5,
  unitThreshold: 5,
};

export interface CountLineInput {
  itemId: number;
  systemCount: number; // what the app believes right now
  counted: number; // what's on the shelf
  /** Cost per COUNT unit, for the dollar-impact sort. Null when unknown. */
  unitCostCents?: number | null;
}

export interface CountVariance {
  itemId: number;
  systemCount: number;
  counted: number;
  delta: number; // counted − system
  /** Percent of system count; null when systemCount is 0 (undefined %). */
  pct: number | null;
  /** |delta| × unitCostCents; null when cost is unknown. */
  impactCents: number | null;
  aboveThreshold: boolean;
}

export function varianceFor(line: CountLineInput, t: VarianceThresholds): CountVariance {
  const delta = line.counted - line.systemCount;
  const pct = line.systemCount === 0 ? null : (delta / line.systemCount) * 100;
  const cost = line.unitCostCents ?? null;
  const impactCents = cost == null ? null : Math.abs(delta) * cost;
  // pct === null with a nonzero delta means found-from-zero / vanished-to-zero
  // relative to a zero baseline — infinite %, always beats the pct rule.
  const beatsPct = delta !== 0 && (pct === null || Math.abs(pct) >= t.pctThreshold);
  const beatsUnits = Math.abs(delta) >= t.unitThreshold && delta !== 0;
  return { itemId: line.itemId, systemCount: line.systemCount, counted: line.counted,
    delta, pct, impactCents, aboveThreshold: beatsPct || beatsUnits };
}

/**
 * Review order: biggest dollar impact first, unknown-cost rows after (sorted
 * by |delta|), clean rows (delta 0) last. This is the whole point of the
 * review screen — the discrepancy that costs the most surfaces on top.
 */
export function reviewCounts(lines: CountLineInput[], t: VarianceThresholds): CountVariance[] {
  return lines.map((l) => varianceFor(l, t)).sort((a, b) => {
    if ((a.delta === 0) !== (b.delta === 0)) return a.delta === 0 ? 1 : -1;
    if (a.impactCents != null && b.impactCents != null && a.impactCents !== b.impactCents) {
      return b.impactCents - a.impactCents;
    }
    if ((a.impactCents == null) !== (b.impactCents == null)) return a.impactCents == null ? 1 : -1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
}

/**
 * Repeated-variance signal: true when 3+ of the item's last 4 counted sessions
 * were above threshold. A one-off variance is shop life; a repeated pattern is
 * structural (bad UOM factor, systematic miscounting, a supplier shorting
 * orders) and should be surfaced, not buried in logs.
 */
export function hasRepeatedVariance(flagsNewestFirst: boolean[]): boolean {
  const recent = flagsNewestFirst.slice(0, 4);
  return recent.filter(Boolean).length >= 3;
}
