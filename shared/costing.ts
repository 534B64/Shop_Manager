// Moving weighted-average cost (Phase 2, ADR 0006) — pure math shared by the
// inventory service and its tests. Costs are integer cents per COUNT unit on
// the item; receipts are entered per PURCHASE unit and converted here.

/** Cost per COUNT unit (unrounded) from a cost per PURCHASE unit and the
 *  item's count-units-per-purchase-unit factor (≤ 0 / missing treated as 1). */
export function countUnitCost(purchaseUnitCostCents: number, factor: number | null | undefined): number {
  const f = factor != null && factor > 0 ? factor : 1;
  return purchaseUnitCostCents / f;
}

/**
 * Average cost per count unit after a receipt of `qty` count units at
 * `unitCostCents` per count unit (may be fractional — it's rounded once, here).
 * When nothing (or less than nothing) is on hand the old average means
 * nothing, so the receipt's cost becomes the average outright.
 */
export function averageAfterReceipt(opts: {
  onHand: number; avgCostCents: number; qty: number; unitCostCents: number;
}): number {
  const { onHand, avgCostCents, qty, unitCostCents } = opts;
  if (qty <= 0) return avgCostCents;
  if (onHand <= 0) return Math.round(unitCostCents);
  return Math.round((onHand * avgCostCents + qty * unitCostCents) / (onHand + qty));
}

/** Extended value of on-hand at average cost (negative on-hand values at 0). */
export function extendedValueCents(onHand: number, avgCostCents: number): number {
  return Math.max(onHand, 0) * avgCostCents;
}
