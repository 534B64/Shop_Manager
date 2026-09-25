import { describe, it, expect } from 'vitest';
import { avgDailyUse, suggestedMin, daysUntilStockout, urgencyCompare } from './reorder';

describe('avgDailyUse', () => {
  it('(baseline + inflows − new) / days', () => {
    // Counted 50 last week, received 20 since, counted 35 today → used 35 over 7 days.
    expect(avgDailyUse({ baselineCounted: 50, inflowsSince: 20, newCounted: 35, days: 7 })).toBe(5);
  });
  it('clamps negative usage (counted more than explainable) to 0', () => {
    expect(avgDailyUse({ baselineCounted: 10, inflowsSince: 0, newCounted: 15, days: 7 })).toBe(0);
  });
  it('window under half a day is meaningless → null', () => {
    expect(avgDailyUse({ baselineCounted: 50, inflowsSince: 0, newCounted: 40, days: 0.2 })).toBeNull();
  });
});

describe('suggestedMin', () => {
  it('covers usage through lead time + buffer, rounded up', () => {
    // 2.5/day × (7-day lead + 3-day buffer) = 25
    expect(suggestedMin(2.5, 7, 3)).toBe(25);
    // 1.4/day × (5 + 3) = 11.2 → 12
    expect(suggestedMin(1.4, 5, 3)).toBe(12);
  });
  it('no usage history → no suggestion (never invent a number)', () => {
    expect(suggestedMin(null, 7, 3)).toBeNull();
    expect(suggestedMin(0, 7, 3)).toBeNull();
  });
});

describe('daysUntilStockout', () => {
  it('count / daily rate', () => {
    expect(daysUntilStockout(10, 2)).toBe(5);
  });
  it('null without a rate', () => {
    expect(daysUntilStockout(10, null)).toBeNull();
    expect(daysUntilStockout(10, 0)).toBeNull();
  });
});

describe('urgencyCompare', () => {
  it('fewest days-until-stockout first; no-rate rows after, deepest below Min first', () => {
    const rows = [
      { count: 10, lowStockThreshold: 12, avgDailyUse: 1 },    // 10 days left
      { count: 4, lowStockThreshold: 10, avgDailyUse: 2 },     // 2 days left
      { count: 0, lowStockThreshold: 8, avgDailyUse: null },   // no rate, 8 below Min
      { count: 3, lowStockThreshold: 5, avgDailyUse: null },   // no rate, 2 below Min
    ];
    const sorted = [...rows].sort(urgencyCompare);
    expect(sorted[0]).toBe(rows[1]);
    expect(sorted[1]).toBe(rows[0]);
    expect(sorted[2]).toBe(rows[2]);
    expect(sorted[3]).toBe(rows[3]);
  });
});
