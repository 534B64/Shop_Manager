import { describe, it, expect } from 'vitest';
import { availabilityCheck } from './stockCheck';

// ROLL_SIZES = [15, 24, 30, 48]; usable = nominal − 1.5 (so 15→13.5, 24→22.5, 30→28.5, 48→46.5).
// acrossIn is the SMALLER part dimension (the side that runs across the roll).

describe('availabilityCheck', () => {
  it('returns unknown when no inventory data is set up (never a false alarm)', () => {
    const r = availabilityCheck({ hasStockData: false, inStockWidths: [24], acrossIn: 10 });
    expect(r.state).toBe('unknown');
  });

  it('returns unknown when there is no usable dimension', () => {
    expect(availabilityCheck({ hasStockData: true, inStockWidths: [24], acrossIn: null }).state).toBe('unknown');
    expect(availabilityCheck({ hasStockData: true, inStockWidths: [24], acrossIn: 0 }).state).toBe('unknown');
  });

  it('in_stock: the optimal (least-waste) width is on the shelf', () => {
    // across 10 → optimal is 15 (usable 13.5). 15 is in stock.
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [15, 24], acrossIn: 10 });
    expect(r.state).toBe('in_stock');
    expect(r.optimalWidth).toBe(15);
    expect(r.useWidth).toBe(15);
  });

  it('suboptimal: optimal width out, but a wider fitting roll is in stock', () => {
    // across 10 → optimal 15 (out). 24 (usable 22.5) still fits → suboptimal, use 24.
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [24, 30], acrossIn: 10 });
    expect(r.state).toBe('suboptimal');
    expect(r.optimalWidth).toBe(15);
    expect(r.useWidth).toBe(24); // least-waste fitting width in stock
  });

  it('suboptimal picks the least-waste in-stock width when several fit', () => {
    // across 10 → optimal 15 (out). In stock 30 and 24 both fit → use 24 (less waste).
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [30, 24], acrossIn: 10 });
    expect(r.state).toBe('suboptimal');
    expect(r.useWidth).toBe(24);
  });

  it('out_of_stock: no fitting width of that color has any stock', () => {
    // across 10 → fits 15/24/30/48, but nothing is in stock.
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [], acrossIn: 10 });
    expect(r.state).toBe('out_of_stock');
    expect(r.optimalWidth).toBe(15);
    expect(r.useWidth).toBeNull();
  });

  it('out_of_stock when the only in-stock width is too narrow for the part', () => {
    // across 20 → needs usable ≥ 20 → 24 (22.5) or wider. Only 15 (13.5) in stock → too narrow.
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [15], acrossIn: 20 });
    expect(r.state).toBe('out_of_stock');
    expect(r.optimalWidth).toBe(24);
    expect(r.useWidth).toBeNull();
  });

  it('a part wider than every roll fits nothing → optimal null, out_of_stock', () => {
    // across 50 → no usable width covers it (max usable 46.5).
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [48], acrossIn: 50 });
    expect(r.optimalWidth).toBeNull();
    expect(r.state).toBe('out_of_stock');
  });

  it('boundary: across exactly equal to a roll usable width still fits', () => {
    // across 13.5 == usable of 15 → 15 fits exactly and is in stock.
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [15], acrossIn: 13.5 });
    expect(r.state).toBe('in_stock');
    expect(r.useWidth).toBe(15);
  });

  it('ignores duplicate in-stock width entries', () => {
    const r = availabilityCheck({ hasStockData: true, inStockWidths: [24, 24, 24], acrossIn: 10 });
    expect(r.fittingInStock).toEqual([24]);
    expect(r.state).toBe('suboptimal');
  });
});
