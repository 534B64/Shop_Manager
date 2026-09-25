// Advisory inventory cross-reference for the estimator (Phase 8).
//
// HARD PRINCIPLE: this is a *stock check*, never stock *consumption*. It answers
// "do we have this color+width on the shelf right now?" (count > 0). It never
// deducts material, never blocks a quote, and never changes price. Color is a
// material *variant* (Red 651 vs Blue 651), not the 2/3-color price tag.
//
// A part can run either orientation, so the dimension that must fit "across" the
// roll is the SMALLER of the two — a wider roll always still cuts the part (with
// more waste). So the check looks across ALL in-stock widths of the chosen color.
import { trueRollWidth } from './rolls';
import { ROLL_SIZES } from './domain';

export type StockState = 'unknown' | 'in_stock' | 'suboptimal' | 'out_of_stock';

export interface StockResult {
  /** unknown → show nothing (no color/inventory data set up — never a false alarm). */
  state: StockState;
  /** Least-waste width for the part (advisory pick), or null if dims unknown. */
  optimalWidth: number | null;
  /** Width to actually use given what's on the shelf (in stock + fits), or null. */
  useWidth: number | null;
  /** In-stock nominal widths (count > 0) of the chosen color that fit the part. */
  fittingInStock: number[];
}

/**
 * The part dimension that must fit "across" the roll: the SMALLER of the two
 * (a part can run either orientation). Shared so client and server can never
 * disagree about how a stock-check request is derived from a quote line.
 */
export function acrossFromDims(widthIn?: number | null, heightIn?: number | null): number | null {
  const dims = [widthIn, heightIn]
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0);
  return dims.length ? Math.min(...dims) : null;
}

/** One quote line's stock-check request — main item or an additional item. */
export interface StockLineQuery {
  materialId: number | null;
  color: string;
  widthIn?: number | null;
  heightIn?: number | null;
}

export interface StockCheckInput {
  /** True if ANY roll SKU exists for this material+color (regardless of count). */
  hasStockData: boolean;
  /** Nominal widths of the chosen color with count > 0. */
  inStockWidths: number[];
  /** The smaller part dimension — the side that must fit across the roll. */
  acrossIn: number | null;
  /** Standard roll sizes to consider (defaults to ROLL_SIZES). */
  rolls?: readonly number[];
}

/** A nominal roll fits the part when its usable width covers the across dimension. */
function fits(nominal: number, acrossIn: number): boolean {
  return trueRollWidth(nominal) >= acrossIn - 1e-9;
}

/**
 * Three-state availability (plus 'unknown'):
 *  - unknown      → no SKUs set up for this material+color: caller shows nothing.
 *  - in_stock     → the optimal (least-waste) width is on the shelf.
 *  - suboptimal   → optimal is out, but a wider fitting width is in stock.
 *  - out_of_stock → no fitting width of that color has any stock.
 *
 * Advisory only — the caller never blocks the quote on this.
 */
export function availabilityCheck(input: StockCheckInput): StockResult {
  const rolls = input.rolls ?? ROLL_SIZES;
  const across = input.acrossIn;

  // No part dimension to reason about, or no inventory data → say nothing.
  if (across == null || across <= 0 || !input.hasStockData) {
    return { state: 'unknown', optimalWidth: null, useWidth: null, fittingInStock: [] };
  }

  // Least-waste width overall (whether or not it's in stock): smallest fitting roll.
  const fittingRolls = [...rolls].filter((w) => fits(w, across)).sort((a, b) => a - b);
  const optimalWidth = fittingRolls.length ? fittingRolls[0] : null;

  // In-stock widths that actually fit the part, least-waste first.
  const fittingInStock = [...new Set(input.inStockWidths)]
    .filter((w) => fits(w, across))
    .sort((a, b) => a - b);

  if (fittingInStock.length === 0) {
    return { state: 'out_of_stock', optimalWidth, useWidth: null, fittingInStock };
  }
  if (optimalWidth != null && fittingInStock.includes(optimalWidth)) {
    return { state: 'in_stock', optimalWidth, useWidth: optimalWidth, fittingInStock };
  }
  // Optimal out, but a (wider) fitting width is on the shelf — use the least-waste one.
  return { state: 'suboptimal', optimalWidth, useWidth: fittingInStock[0], fittingInStock };
}
