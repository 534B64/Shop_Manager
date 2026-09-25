// Price book engine. Advisory — the human always sets the final price.
// Each material carries a pricing rule, fully editable in admin (Materials page).
//
// A quote is made of "lines": the main item plus any additional items. Each line
// is priced independently so a 2/3-color tag on one line never inflates the others.
// Per line:  price = rule price × qty × (this line's color multiplier)
// (The flat complexity surcharge was removed entirely on 2026-07-02.)
import type { PriceMode } from './domain';

export interface PriceRule {
  priceMode: PriceMode | string;
  rateCents: number;
  minQty?: number;
  colorMultiplier?: boolean; // false = this material ignores 2/3-color (e.g. magnets)
}

export interface PriceInput {
  widthIn?: number;
  heightIn?: number;
  qty: number;
  colorMult?: number; // 1 | 2 | 3 — color multiplier for THIS line only
}

/** The color multiplier actually applied, honoring the material's opt-out. */
export function effectiveColorMult(rule: PriceRule, colorMult: number | undefined): number {
  if (rule.colorMultiplier === false) return 1;
  const m = colorMult ?? 1;
  return m >= 1 ? m : 1;
}

/** Suggested price in cents for one line, or null when the rule can't price it. */
export function suggestPrice(rule: PriceRule, input: PriceInput): number | null {
  const qty = Math.max(input.qty, rule.minQty ?? 1); // minimums (e.g. transfers: 2 shirts)
  const mult = effectiveColorMult(rule, input.colorMult);
  if (rule.rateCents <= 0) return null;

  let perPiece: number | null = null;
  switch (rule.priceMode) {
    case 'per_inch_max': {
      const longest = Math.max(input.widthIn ?? 0, input.heightIn ?? 0);
      if (longest <= 0) return null;
      perPiece = rule.rateCents * longest;
      break;
    }
    case 'per_sqft': {
      if (!input.widthIn || !input.heightIn) return null;
      perPiece = rule.rateCents * ((input.widthIn * input.heightIn) / 144);
      break;
    }
    case 'per_unit':
    case 'flat':
      perPiece = rule.rateCents;
      break;
    default:
      return null; // custom — no suggestion
  }
  // Round up to whole dollars.
  return Math.ceil((perPiece * qty * mult) / 100) * 100;
}
