import { describe, it, expect } from 'vitest';
import { averageAfterReceipt, countUnitCost, extendedValueCents } from './costing';

describe('moving weighted-average cost', () => {
  it('blends a receipt into the existing average', () => {
    // 10 @ $1.00 + 10 @ $2.00 → $1.50
    expect(averageAfterReceipt({ onHand: 10, avgCostCents: 100, qty: 10, unitCostCents: 200 })).toBe(150);
  });

  it('rounds half up to whole cents', () => {
    // (3×100 + 1×101) / 4 = 100.25 → 100 ; (1×100 + 1×101) / 2 = 100.5 → 101
    expect(averageAfterReceipt({ onHand: 3, avgCostCents: 100, qty: 1, unitCostCents: 101 })).toBe(100);
    expect(averageAfterReceipt({ onHand: 1, avgCostCents: 100, qty: 1, unitCostCents: 101 })).toBe(101);
  });

  it('takes the receipt cost outright when on-hand is zero or negative', () => {
    expect(averageAfterReceipt({ onHand: 0, avgCostCents: 999, qty: 5, unitCostCents: 250 })).toBe(250);
    expect(averageAfterReceipt({ onHand: -3, avgCostCents: 999, qty: 5, unitCostCents: 250 })).toBe(250);
  });

  it('ignores a zero-quantity receipt', () => {
    expect(averageAfterReceipt({ onHand: 4, avgCostCents: 120, qty: 0, unitCostCents: 5000 })).toBe(120);
  });

  it('converts purchase-unit cost to count units before blending', () => {
    // Box of 12 for $6.00 → 50¢ each; 12 on hand at 40¢ + 12 at 50¢ → 45¢.
    const each = countUnitCost(600, 12);
    expect(each).toBe(50);
    expect(averageAfterReceipt({ onHand: 12, avgCostCents: 40, qty: 12, unitCostCents: each })).toBe(45);
    // Fractional count cost is kept until the final rounding: $2.50/100 = 2.5¢.
    expect(averageAfterReceipt({ onHand: 0, avgCostCents: 0, qty: 100, unitCostCents: countUnitCost(250, 100) })).toBe(3);
    expect(averageAfterReceipt({ onHand: 100, avgCostCents: 2, qty: 100, unitCostCents: countUnitCost(250, 100) })).toBe(2); // 2.25
  });

  it('treats a missing or non-positive factor as 1', () => {
    expect(countUnitCost(300, 0)).toBe(300);
    expect(countUnitCost(300, null)).toBe(300);
  });

  it('values negative on-hand at zero', () => {
    expect(extendedValueCents(10, 45)).toBe(450);
    expect(extendedValueCents(-2, 45)).toBe(0);
  });
});
