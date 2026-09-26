// Job aggregate service: PO generation and server-side quote-math
// verification. Routes stay HTTP-only; this is where the rules live.
import { eq, sql, like, inArray } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import { jobs, materials } from '../../db/schema/index.js';
import { taxRatePct } from '../settings/index.js';
import { combinedSuggestedCents, grandTotalCents, type VerifyLine } from '../../../shared/priceVerify.js';

// ---- PO generation ----
// PO: MMDDYY + 3-digit daily sequence (e.g. order 35 on 06/12/26 → 061226035).
// Call it with the transaction that inserts the job, so two orders can't
// read the same count.
export async function generatePo(dbx: Db = db): Promise<string> {
  const d = new Date();
  const day = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + String(d.getFullYear()).slice(2);
  const [{ n }] = await dbx.select({ n: sql<number>`count(*)` }).from(jobs)
    .where(like(jobs.po, `${day}%`));
  return `${day}${String(n + 1).padStart(3, '0')}`;
}

// ---- Price override (Phase 3, ADR 0007) ----
// A saved price that differs from the estimator's suggestion is an override:
// still allowed (the estimator is advisory) but it needs a manager. Only a
// change that creates or alters an override asks — re-saving an already
// approved override untouched does not.
export function isOverride(suggested: number | null | undefined, final: number | null | undefined): boolean {
  return suggested != null && final != null && final !== suggested;
}
export function needsOverrideApproval(
  before: { suggested: number | null; final: number | null } | null,
  after: { suggested: number | null; final: number | null },
): boolean {
  if (!isOverride(after.suggested, after.final)) return false;
  return !before || before.suggested !== after.suggested || before.final !== after.final;
}

// ---- Server-side quote-math verification (Phase 11 hardening) ----
// The client computes the suggested total and grand total in the browser; the
// server now recomputes both from its own settings + material rules and stores
// its own answer. A mismatch (stale tab, old tax rate) is returned as a
// non-blocking `priceCheck` warning — the human-set finalPriceCents is never
// second-guessed.
export interface VerifyItemInput {
  materialId?: number | null; widthIn?: number | null; heightIn?: number | null;
  qty: number; colorMult?: number | null;
}
export interface VerifyInput {
  materialId?: number | null; widthIn?: number | null; heightIn?: number | null;
  quantity?: number | null; mainColorMult?: number | null;
  items?: VerifyItemInput[];
  finalPriceCents: number; taxable: boolean; discountPct?: number | null;
  clientSuggestedCents?: number | null; clientTotalCents?: number | null;
}
export interface PriceCheck {
  verified: boolean;
  serverSuggestedCents: number | null;
  clientSuggestedCents: number | null;
  serverTotalCents: number;
  clientTotalCents: number | null;
}

export async function verifyQuoteMath(input: VerifyInput, dbx: Db = db): Promise<{ suggestedCents: number | null; totalCents: number; taxRatePct: number; priceCheck: PriceCheck }> {
  const taxRate = await taxRatePct(dbx);
  const ids = [...new Set([input.materialId, ...(input.items ?? []).map((i) => i.materialId)]
    .filter((x): x is number => typeof x === 'number'))];
  const mats = ids.length ? await dbx.select().from(materials).where(inArray(materials.id, ids)) : [];
  const ruleFor = (id?: number | null) => mats.find((m) => m.id === id) ?? null;

  const lines: VerifyLine[] = [
    { rule: ruleFor(input.materialId), widthIn: input.widthIn, heightIn: input.heightIn,
      qty: input.quantity ?? 1, colorMult: input.mainColorMult },
    ...(input.items ?? []).map((it) => ({
      rule: ruleFor(it.materialId), widthIn: it.widthIn, heightIn: it.heightIn,
      qty: it.qty || 1, colorMult: it.colorMult,
    })),
  ];
  const suggestedCents = combinedSuggestedCents(lines);
  const totalCents = grandTotalCents(input.finalPriceCents, input.taxable, taxRate, input.discountPct ?? 0);
  const suggestedMatch = input.clientSuggestedCents == null || suggestedCents == null
    || suggestedCents === input.clientSuggestedCents;
  const totalMatch = input.clientTotalCents == null || totalCents === input.clientTotalCents;
  return {
    suggestedCents, totalCents, taxRatePct: taxRate,
    priceCheck: {
      verified: suggestedMatch && totalMatch,
      serverSuggestedCents: suggestedCents,
      clientSuggestedCents: input.clientSuggestedCents ?? null,
      serverTotalCents: totalCents,
      clientTotalCents: input.clientTotalCents ?? null,
    },
  };
}
