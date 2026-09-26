// Quote math on the form: per-line suggestions, roll auto-pick, and totals.
// Mirrors the server's re-check (shared/priceVerify.ts) — same functions,
// same rounding. Pure — tested in draft.test.ts.
import type { Material } from '../../../lib/types';
import { parseDollarsToCents } from '../../../lib/format';
import { suggestPrice } from '../../../../shared/pricing';
import { autoRollWidth } from '../../../../shared/rolls';
import { grandTotalCents } from '../../../../shared/priceVerify';
import type { LineDraft, QuoteDraft } from './draft';

/** The 2/3-color price tag can apply to this material. */
export const canColor = (m: Material | null | undefined): boolean =>
  !!m && m.colorMultiplier !== false && m.priceMode !== 'custom';

const num = (s: string) => Number(s) || null;

/** Roll width for a roll material: the least-waste pick unless someone chose one. */
export function effectiveRoll(line: LineDraft, m: Material | null | undefined): number | null {
  if (!m?.usesRoll) return null;
  return line.rollAuto ? autoRollWidth(num(line.widthIn), num(line.heightIn)) : num(line.rollWidthIn);
}

export function lineSuggestion(line: LineDraft, m: Material | null | undefined): number | null {
  if (!m) return null;
  return suggestPrice(m, { widthIn: num(line.widthIn) ?? undefined, heightIn: num(line.heightIn) ?? undefined,
    qty: Number(line.qty) || 1, colorMult: line.colorMult });
}

export interface QuoteMath {
  lineSuggestions: (number | null)[];
  /** Sum of every priceable line, or null when none can be priced. */
  suggested: number | null;
  priceCents: number | null;
  taxCents: number;
  discountPct: number;
  discountCents: number;
  grandTotal: number;
  /** A final price different from the suggestion — needs a manager on save. */
  override: boolean;
}

export function quoteMath(d: QuoteDraft, materials: Material[], taxRatePct: number, levels: Record<string, number>): QuoteMath {
  const lineSuggestions = d.lines.map((l) => lineSuggestion(l, materials.find((m) => m.id === l.materialId)));
  const priced = lineSuggestions.filter((s): s is number => s != null);
  const suggested = priced.length ? priced.reduce((a, b) => a + b, 0) : null;
  const priceCents = parseDollarsToCents(d.finalPrice);
  const sub = priceCents ?? 0;
  const discountPct = d.applyDiscount && d.customer.level > 0 ? (levels[String(d.customer.level)] ?? 0) : 0;
  const grandTotal = grandTotalCents(sub, d.taxable, taxRatePct, discountPct);
  const taxCents = d.taxable ? Math.round((sub * taxRatePct) / 100) : 0;
  return {
    lineSuggestions, suggested, priceCents, taxCents, discountPct,
    discountCents: sub + taxCents - grandTotal, grandTotal,
    override: suggested != null && priceCents != null && priceCents !== suggested,
  };
}
