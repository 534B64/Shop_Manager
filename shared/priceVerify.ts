// Server-side re-check of quote math (Phase 11 hardening).
//
// The Quotes page computes the suggested total and the grand total in the
// browser. Until now the server stored whatever the client sent — a stale tab
// (old tax rate) could save wrong numbers silently. The server now recomputes
// both with THIS module and stores its own answer; a mismatch is reported back
// to the client as a non-blocking warning.
//
// The estimator stays advisory: the human-set finalPriceCents is never
// second-guessed. Only derived math (suggested total, tax/discount total) is
// verified. Rounding here must mirror src/pages/Quotes.tsx exactly.
import { suggestPrice, type PriceRule } from './pricing';

export interface VerifyLine {
  /** The line material's price rule, or null when unknown / not set. */
  rule: PriceRule | null;
  widthIn?: number | null;
  heightIn?: number | null;
  qty: number;
  colorMult?: number | null;
}

/**
 * Suggested total across all lines (main + additional items): the sum of every
 * line the price book can price. Lines with no rule or a 'custom' rule
 * contribute nothing (they're priced by hand in the main Price field).
 * Returns null when NO line is priceable — mirrors the client's `anySuggestion`.
 */
export function combinedSuggestedCents(lines: VerifyLine[]): number | null {
  let any = false;
  let total = 0;
  for (const ln of lines) {
    if (!ln.rule) continue;
    const s = suggestPrice(ln.rule, {
      widthIn: ln.widthIn ?? undefined,
      heightIn: ln.heightIn ?? undefined,
      qty: ln.qty,
      colorMult: ln.colorMult ?? undefined,
    });
    if (s != null) { any = true; total += s; }
  }
  return any ? total : null;
}

/**
 * Grand total actually charged, from the human-set price:
 * subtotal → + tax (rounded) → − level discount applied AFTER tax (rounded).
 * Same rounding as the Quotes page.
 */
export function grandTotalCents(
  finalPriceCents: number,
  taxable: boolean,
  taxRatePct: number,
  discountPct: number,
): number {
  const tax = taxable ? Math.round((finalPriceCents * taxRatePct) / 100) : 0;
  const discount = discountPct > 0 ? Math.round(((finalPriceCents + tax) * discountPct) / 100) : 0;
  return finalPriceCents + tax - discount;
}
