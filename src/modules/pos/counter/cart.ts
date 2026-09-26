// Counter-sale cart: pure operations + the totals preview. Totals use the
// same shared/invoice.ts priceCounterSale the server runs, so the screen and
// the invoice agree to the cent. Lines are taxed unless the chip is turned off
// (owner decision D10); a tax-exempt sale taxes nothing. Integer cents.
import { priceCounterSale, taxExemptReason, type PricedInvoice } from '../../../../shared/invoice';

export const MAX_QTY = 9999;
export const MAX_LINES = 50;

export interface CartLine {
  key: string;
  description: string;
  qty: number;
  /** Null until the cashier enters a price. */
  unitPriceCents: number | null;
  taxable: boolean;
  inventoryItemId?: number;
  /** On hand when it was added (display only; the sale never blocks on stock). */
  onHand?: number;
  /** A price-book / estimator suggestion; a different price is an override (manager). */
  suggestedUnitPriceCents?: number | null;
}

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${++seq}`;

export function addFreeLine(cart: CartLine[], description: string, unitPriceCents: number | null, taxable = true): CartLine[] {
  return [...cart, { key: newKey(), description: description.trim(), qty: 1, unitPriceCents, taxable }];
}

/** A stock item goes on one line (the server refuses duplicates) — adding it again bumps qty. */
export function addStockLine(cart: CartLine[], item: { id: number; name: string; count?: number }, taxable = true): CartLine[] {
  const hit = cart.find((l) => l.inventoryItemId === item.id);
  if (hit) return setQty(cart, hit.key, hit.qty + 1);
  return [...cart, { key: newKey(), description: item.name, qty: 1, unitPriceCents: null, taxable,
    inventoryItemId: item.id, onHand: item.count }];
}

const update = (cart: CartLine[], key: string, f: (l: CartLine) => CartLine) => cart.map((l) => (l.key === key ? f(l) : l));

export const clampQty = (n: number) => (Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(1, Math.round(n))) : 1);
export const setQty = (cart: CartLine[], key: string, qty: number) => update(cart, key, (l) => ({ ...l, qty: clampQty(qty) }));
export const setPrice = (cart: CartLine[], key: string, cents: number | null) => update(cart, key, (l) => ({ ...l, unitPriceCents: cents }));
export const setTaxable = (cart: CartLine[], key: string, taxable: boolean) => update(cart, key, (l) => ({ ...l, taxable }));
export const setDescription = (cart: CartLine[], key: string, d: string) => update(cart, key, (l) => ({ ...l, description: d }));
export const removeLine = (cart: CartLine[], key: string) => cart.filter((l) => l.key !== key);

/** The line's price differs from a suggestion → the sale needs a manager. */
export const isOverride = (l: CartLine) =>
  l.suggestedUnitPriceCents != null && l.unitPriceCents != null && l.unitPriceCents !== l.suggestedUnitPriceCents;

/** Per-line tax + totals, exactly as the server will price the sale (no discount at the counter). */
export function cartTotals(cart: CartLine[], taxRatePct: number, taxExempt = false): PricedInvoice {
  return priceCounterSale(cart.map((l) => ({ qty: l.qty, subtotalCents: l.qty * (l.unitPriceCents ?? 0), taxable: l.taxable })),
    taxRatePct, { taxExempt });
}

/** The sale-level exemption: off, or on with the reason the server needs. */
export interface TaxExemption { on: boolean; reason: string }

/** Why the exemption blocks the sale (null = fine). */
export const exemptionProblem = (x: TaxExemption) =>
  x.on && !taxExemptReason(x.reason) ? 'Tax exempt: say why (e.g. resale certificate).' : null;

/** Body fields for POST /api/pos/sale. */
export const exemptionBody = (x: TaxExemption) =>
  x.on ? { taxExempt: true, taxExemptReason: taxExemptReason(x.reason) ?? '' } : {};

/** Why the sale can't be completed yet (empty = ready). */
export function cartProblems(cart: CartLine[], totalCents: number): string[] {
  const out: string[] = [];
  if (cart.length === 0) out.push('Add an item to the sale.');
  if (cart.length > MAX_LINES) out.push(`A sale holds at most ${MAX_LINES} lines.`);
  const noPrice = cart.filter((l) => l.unitPriceCents == null);
  if (noPrice.length) out.push(`Enter a price for ${noPrice.map((l) => l.description || 'the new line').join(', ')}.`);
  const noName = cart.filter((l) => !l.description.trim());
  if (noName.length) out.push('Every line needs a description.');
  if (cart.length && !noPrice.length && totalCents <= 0) out.push('The sale must be more than $0.00.');
  return out;
}

/** Body lines for POST /api/pos/sale. */
export function toSaleLines(cart: CartLine[]) {
  return cart.map((l) => ({
    description: l.description.trim(), qty: l.qty, unitPriceCents: l.unitPriceCents ?? 0, taxable: l.taxable,
    ...(l.inventoryItemId != null ? { inventoryItemId: l.inventoryItemId } : {}),
    ...(l.suggestedUnitPriceCents != null ? { suggestedUnitPriceCents: l.suggestedUnitPriceCents } : {}),
  }));
}
