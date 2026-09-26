// Invoice, return, and drawer math (Phase 3, ADR 0007). Pure — used by the
// sales module on the server and available to the client for previews.
//
// Rounding rules (documented in ADR 0007):
// - Tax is computed PER LINE: round-half-up(line subtotal × rate / 100),
//   using the same Math.round the Quotes page uses. Invoice tax = sum of lines.
// - The customer-level discount stays what it is today: a % applied AFTER tax
//   to the whole ticket, round((subtotal + tax) × pct / 100). It is then
//   allocated to lines in proportion to each line's subtotal + tax (largest
//   remainder), so every line carries its share and lines sum to the invoice.
// - Line total = subtotal + tax − discount share. Invoice totals = line sums.
// For a one-line invoice this is exactly shared/priceVerify grandTotalCents.

export const TENDER_METHODS = ['cash', 'check', 'card', 'credit', 'other'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export interface LineInput {
  qty: number;
  subtotalCents: number;
  taxable: boolean;
}

export interface PricedLine extends LineInput {
  taxRatePct: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
}

export interface PricedInvoice {
  lines: PricedLine[];
  subtotalCents: number;
  taxCents: number;
  discountPct: number;
  discountCents: number;
  totalCents: number;
}

/** Tax on one line, rounded half-up to the cent. */
export function lineTaxCents(subtotalCents: number, taxable: boolean, taxRatePct: number): number {
  return taxable ? Math.round((subtotalCents * taxRatePct) / 100) : 0;
}

/** Split `amount` across weights so the parts sum exactly (largest remainder). */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount === 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map((r) => Math.floor(r));
  let left = amount - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i]++;
  return parts;
}

/** Price an invoice: per-line tax, the after-tax discount allocated to lines. */
export function priceInvoice(lines: LineInput[], taxRatePct: number, discountPct = 0): PricedInvoice {
  const taxed = lines.map((l) => ({ ...l, taxRatePct: l.taxable ? taxRatePct : 0, taxCents: lineTaxCents(l.subtotalCents, l.taxable, taxRatePct) }));
  const subtotalCents = taxed.reduce((s, l) => s + l.subtotalCents, 0);
  const taxCents = taxed.reduce((s, l) => s + l.taxCents, 0);
  const pct = discountPct > 0 ? discountPct : 0;
  const discountCents = pct > 0 ? Math.round(((subtotalCents + taxCents) * pct) / 100) : 0;
  const shares = allocate(discountCents, taxed.map((l) => l.subtotalCents + l.taxCents));
  const priced = taxed.map((l, i) => ({ ...l, discountCents: shares[i], totalCents: l.subtotalCents + l.taxCents - shares[i] }));
  return { lines: priced, subtotalCents, taxCents, discountPct: pct, discountCents, totalCents: subtotalCents + taxCents - discountCents };
}

// ---- Counter sale tax (owner decision D10, 2026-09-26) ----

/** Reasons offered for a tax-exempt counter sale (any short reason is accepted). */
export const TAX_EXEMPT_REASONS = ['Resale certificate', 'Nonprofit', 'Government', 'Out of state'] as const;
export const TAX_EXEMPT_REASON_MIN = 3;
export const TAX_EXEMPT_REASON_MAX = 120;

/** A usable exemption reason (trimmed), or null when it's missing / too short. */
export function taxExemptReason(s: string | null | undefined): string | null {
  const r = (s ?? '').trim();
  return r.length >= TAX_EXEMPT_REASON_MIN && r.length <= TAX_EXEMPT_REASON_MAX ? r : null;
}

export interface CounterLineInput { qty: number; subtotalCents: number; taxable?: boolean }

/**
 * Price a counter sale the way POST /api/pos/sale does: every line is taxed
 * unless it says `taxable: false` (the sale-level `taxable` sets the default),
 * and a tax-exempt sale taxes nothing. No discount at the counter. The /pos and
 * Quick Order previews call this too, so the screen equals the invoice.
 */
export function priceCounterSale(lines: CounterLineInput[], taxRatePct: number,
  opts: { taxExempt?: boolean; defaultTaxable?: boolean } = {}): PricedInvoice {
  const dflt = opts.defaultTaxable ?? true;
  return priceInvoice(lines.map((l) => ({ qty: l.qty, subtotalCents: l.subtotalCents,
    taxable: !opts.taxExempt && (l.taxable ?? dflt) })), taxRatePct, 0);
}

/**
 * Tax + discount that reproduce a total already charged (pre-Phase-3 jobs
 * whose stored total was computed at a tax rate that has since changed).
 * Finds the tax T with subtotal + T − round((subtotal + T) × pct / 100) = total;
 * if no whole-cent T hits it exactly, the remainder goes into the discount.
 */
export function taxForTotal(subtotalCents: number, discountPct: number, totalCents: number): { taxCents: number; discountCents: number } {
  const disc = (t: number) => (discountPct > 0 ? Math.round(((subtotalCents + t) * discountPct) / 100) : 0);
  const g = (t: number) => subtotalCents + t - disc(t);
  let lo = 0, hi = Math.max(0, totalCents * 2 + 100);
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (g(mid) >= totalCents) hi = mid; else lo = mid + 1; }
  const t = Math.max(0, lo);
  return { taxCents: t, discountCents: subtotalCents + t - totalCents };
}

export interface ReturnableLine {
  qty: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
}

export interface LineRefund {
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Value of returning `qty` more units of a line when `alreadyQty` were returned
 * before. Each part is the difference of cumulative pro-rata shares, so the
 * returns of a whole line add up to exactly the line (no drifting cents).
 * Returns null when qty is not a positive whole number or exceeds what's left.
 */
export function returnLineRefund(line: ReturnableLine, alreadyQty: number, qty: number): LineRefund | null {
  if (!Number.isInteger(qty) || qty <= 0 || alreadyQty + qty > line.qty) return null;
  const cum = (x: number, q: number) => Math.round((x * q) / line.qty);
  const part = (x: number) => cum(x, alreadyQty + qty) - cum(x, alreadyQty);
  const subtotalCents = part(line.subtotalCents);
  const taxCents = part(line.taxCents);
  const discountCents = part(line.discountCents);
  return { subtotalCents, taxCents, discountCents, totalCents: subtotalCents + taxCents - discountCents };
}

/**
 * Money to hand back for a return worth `returnCents`: the customer is only
 * refunded what they overpaid once the return lowers what they owe.
 * paidNetCents = live payments − live refunds on the job so far.
 */
export function refundDueCents(opts: {
  returnCents: number; invoiceTotalCents: number; returnedBeforeCents: number; paidNetCents: number;
}): number {
  const owedAfter = opts.invoiceTotalCents - opts.returnedBeforeCents - opts.returnCents;
  return Math.min(opts.returnCents, Math.max(0, opts.paidNetCents - owedAfter));
}

/** Change handed back on a cash payment; null when tendered is short. */
export function changeCents(amountCents: number, tenderedCents: number): number | null {
  return tenderedCents >= amountCents ? tenderedCents - amountCents : null;
}

/** Over (+) / short (−): what was counted minus what should be there. */
export function overShortCents(expectedCents: number, countedCents: number): number {
  return countedCents - expectedCents;
}

export const formatInvoiceNumber = (n: number) => String(n).padStart(6, '0');

/** "000042" / "42" → 42; null when it isn't a positive whole number. */
export function parseInvoiceNumber(s: string): number | null {
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// ---- Z-report ----

export interface ZPayment { method: string; kind: string; amountCents: number; voided: boolean }
export interface ZInvoice { number: number; subtotalCents: number; taxCents: number; discountCents: number; totalCents: number }
/** A void counts what it cancelled: the invoice total/tax minus returns already
 *  taken on it (those are in `returns`), so nothing is subtracted twice. */
export interface ZVoid { netTotalCents: number; netTaxCents: number; refundCents: number }
export interface ZReturn { totalCents: number; taxCents: number; refundCents: number }

export interface ZReportInput {
  openingFloatCents: number;
  payments: ZPayment[];
  invoices: ZInvoice[];
  voids: ZVoid[];
  returns: ZReturn[];
  countedCashCents: number | null;
  countedChecksCents: number | null;
}

export interface MethodTotals { count: number; paymentsCents: number; refundsCents: number; netCents: number }

export interface ZReport {
  openingFloatCents: number;
  byMethod: Record<string, MethodTotals>;
  paymentsCents: number;
  refundsCents: number;
  voidedPayments: { count: number; cents: number };
  sales: {
    invoiceCount: number; firstNumber: string | null; lastNumber: string | null;
    subtotalCents: number; taxCents: number; discountCents: number; totalCents: number;
  };
  voids: { count: number; totalCents: number; taxCents: number; refundCents: number };
  returns: { count: number; totalCents: number; taxCents: number; refundCents: number };
  netSalesCents: number;
  netTaxCents: number;
  cash: { expectedCents: number; countedCents: number | null; overShortCents: number | null };
  checks: { expectedCents: number; countedCents: number | null; overShortCents: number | null };
}

export interface SalesTotalsZ { totalCents: number; taxCents: number }

/** Net sales / net tax: invoices issued − what voids cancelled − returns (the
 *  Z-report rule; the date-range sales report uses the same one). */
export function netSales(sales: SalesTotalsZ, voids: SalesTotalsZ, returns: SalesTotalsZ) {
  return {
    netSalesCents: sales.totalCents - voids.totalCents - returns.totalCents,
    netTaxCents: sales.taxCents - voids.taxCents - returns.taxCents,
  };
}

/** End-of-day totals for one drawer session. Voided payment rows are listed
 *  but excluded from every total and from expected cash. */
export function buildZReport(input: ZReportInput): ZReport {
  const byMethod: Record<string, MethodTotals> = {};
  let paymentsCents = 0, refundsCents = 0;
  const voidedPayments = { count: 0, cents: 0 };
  for (const p of input.payments) {
    if (p.voided) { voidedPayments.count++; voidedPayments.cents += p.amountCents; continue; }
    const m = (byMethod[p.method] ??= { count: 0, paymentsCents: 0, refundsCents: 0, netCents: 0 });
    m.count++;
    if (p.kind === 'refund') { m.refundsCents += p.amountCents; refundsCents += p.amountCents; }
    else { m.paymentsCents += p.amountCents; paymentsCents += p.amountCents; }
    m.netCents = m.paymentsCents - m.refundsCents;
  }
  const nums = input.invoices.map((i) => i.number).sort((a, b) => a - b);
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const sales = {
    invoiceCount: input.invoices.length,
    firstNumber: nums.length ? formatInvoiceNumber(nums[0]) : null,
    lastNumber: nums.length ? formatInvoiceNumber(nums[nums.length - 1]) : null,
    subtotalCents: sum(input.invoices, (i) => i.subtotalCents),
    taxCents: sum(input.invoices, (i) => i.taxCents),
    discountCents: sum(input.invoices, (i) => i.discountCents),
    totalCents: sum(input.invoices, (i) => i.totalCents),
  };
  const voids = { count: input.voids.length, totalCents: sum(input.voids, (v) => v.netTotalCents),
    taxCents: sum(input.voids, (v) => v.netTaxCents), refundCents: sum(input.voids, (v) => v.refundCents) };
  const returns = { count: input.returns.length, totalCents: sum(input.returns, (r) => r.totalCents),
    taxCents: sum(input.returns, (r) => r.taxCents), refundCents: sum(input.returns, (r) => r.refundCents) };
  const cashNet = byMethod.cash?.netCents ?? 0;
  const checkNet = byMethod.check?.netCents ?? 0;
  const expectedCash = input.openingFloatCents + cashNet;
  return {
    openingFloatCents: input.openingFloatCents,
    byMethod, paymentsCents, refundsCents, voidedPayments, sales, voids, returns,
    ...netSales(sales, voids, returns),
    cash: { expectedCents: expectedCash, countedCents: input.countedCashCents,
      overShortCents: input.countedCashCents != null ? overShortCents(expectedCash, input.countedCashCents) : null },
    checks: { expectedCents: checkNet, countedCents: input.countedChecksCents,
      overShortCents: input.countedChecksCents != null ? overShortCents(checkNet, input.countedChecksCents) : null },
  };
}
