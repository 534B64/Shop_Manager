import { describe, it, expect } from 'vitest';
import {
  varianceFor, reviewCounts, hasRepeatedVariance,
  DEFAULT_VARIANCE_THRESHOLDS, type VarianceThresholds,
} from './countReview';

const T: VarianceThresholds = { pctThreshold: 5, unitThreshold: 5 };

describe('varianceFor — threshold flagging', () => {
  it('no variance → not flagged, zero delta, 0%', () => {
    const v = varianceFor({ itemId: 1, systemCount: 10, counted: 10 }, T);
    expect(v.delta).toBe(0);
    expect(v.pct).toBe(0);
    expect(v.aboveThreshold).toBe(false);
  });

  it('flags via the percent rule even when units are small (10 → 9 is -10%)', () => {
    const v = varianceFor({ itemId: 1, systemCount: 10, counted: 9 }, T);
    expect(v.pct).toBeCloseTo(-10);
    expect(v.aboveThreshold).toBe(true);
  });

  it('flags via the unit rule even when percent is small (1000 → 994 is -0.6% but 6 units)', () => {
    const v = varianceFor({ itemId: 1, systemCount: 1000, counted: 994 }, T);
    expect(Math.abs(v.pct!)).toBeLessThan(5);
    expect(v.aboveThreshold).toBe(true);
  });

  it('small drift under both rules is not flagged (1000 → 996: -0.4%, 4 units)', () => {
    const v = varianceFor({ itemId: 1, systemCount: 1000, counted: 996 }, T);
    expect(v.aboveThreshold).toBe(false);
  });

  it('found-from-zero has null pct but always flags (system 0, counted 2)', () => {
    const v = varianceFor({ itemId: 1, systemCount: 0, counted: 2 }, T);
    expect(v.pct).toBeNull();
    expect(v.aboveThreshold).toBe(true);
  });

  it('zero counted from zero system is clean', () => {
    const v = varianceFor({ itemId: 1, systemCount: 0, counted: 0 }, T);
    expect(v.aboveThreshold).toBe(false);
  });

  it('dollar impact = |delta| × unit cost; null without a cost', () => {
    expect(varianceFor({ itemId: 1, systemCount: 10, counted: 7, unitCostCents: 250 }, T).impactCents).toBe(750);
    expect(varianceFor({ itemId: 1, systemCount: 10, counted: 7 }, T).impactCents).toBeNull();
  });

  it('default thresholds are ±5% / 5 units', () => {
    expect(DEFAULT_VARIANCE_THRESHOLDS).toEqual({ pctThreshold: 5, unitThreshold: 5 });
  });
});

describe('reviewCounts — dollar-impact ordering', () => {
  it('biggest impact first, unknown-cost variances next (by |delta|), clean rows last', () => {
    const out = reviewCounts([
      { itemId: 1, systemCount: 10, counted: 10, unitCostCents: 9999 }, // clean
      { itemId: 2, systemCount: 10, counted: 8, unitCostCents: 100 },   // $2.00
      { itemId: 3, systemCount: 10, counted: 9, unitCostCents: 5000 },  // $50.00
      { itemId: 4, systemCount: 10, counted: 4 },                       // no cost, |Δ|=6
      { itemId: 5, systemCount: 10, counted: 7 },                       // no cost, |Δ|=3
    ], T);
    expect(out.map((v) => v.itemId)).toEqual([3, 2, 4, 5, 1]);
  });
});

describe('hasRepeatedVariance', () => {
  it('3 of the last 4 flagged → structural signal', () => {
    expect(hasRepeatedVariance([true, true, false, true, false, false])).toBe(true);
  });
  it('2 of the last 4 → no signal', () => {
    expect(hasRepeatedVariance([true, false, true, false, true])).toBe(false);
  });
  it('short history counts what exists', () => {
    expect(hasRepeatedVariance([true, true, true])).toBe(true);
    expect(hasRepeatedVariance([true, true])).toBe(false);
    expect(hasRepeatedVariance([])).toBe(false);
  });
});
