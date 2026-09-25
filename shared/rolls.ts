// Vinyl roll selection. A roll's usable width is 1.5" less than its nominal size
// (margins / pinch rollers), so a "15 roll" really yields 13.5" of print width.
//
// Auto-pick rule: a part can run either orientation, so either dimension may go
// "across" the roll. For each orientation, take the smallest standard roll whose
// usable width still fits; choose the orientation+roll with the LEAST waste across.
// Examples (see tests): 25×13 → 15" roll; 24×2 → 30" roll.
import { ROLL_SIZES } from './domain';

export const ROLL_MARGIN_IN = 1.5;
const EPS = 1e-9;

/** Usable print width of a nominal roll (nominal − 1.5"). */
export function trueRollWidth(nominal: number): number {
  return nominal - ROLL_MARGIN_IN;
}

/**
 * Best standard roll width for a part, considering both orientations.
 * Returns the nominal roll size, or the widest roll when nothing fits
 * (so the UI still suggests something), or null with no usable dimensions.
 */
export function autoRollWidth(
  dimA?: number | null,
  dimB?: number | null,
  rolls: readonly number[] = ROLL_SIZES,
): number | null {
  const dims = [dimA, dimB].filter((d): d is number => typeof d === 'number' && d > 0);
  if (dims.length === 0 || rolls.length === 0) return null;

  let best: { roll: number; waste: number } | null = null;
  for (const across of dims) {
    for (const roll of rolls) {
      const usable = trueRollWidth(roll);
      if (usable + EPS >= across) {
        const waste = usable - across;
        if (!best || waste < best.waste - EPS) best = { roll, waste };
      }
    }
  }
  // Nothing fits across (oversized part) → fall back to the widest roll.
  return best ? best.roll : Math.max(...rolls);
}
