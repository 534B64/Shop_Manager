import { describe, it, expect } from 'vitest';
import { suggestPrice, effectiveColorMult } from './pricing';

describe('price book — shop price list', () => {
  it('651 vinyl: $1/inch of longest side', () => {
    expect(suggestPrice({ priceMode: 'per_inch_max', rateCents: 100 }, { widthIn: 24, heightIn: 12, qty: 1 })).toBe(2400);
    expect(suggestPrice({ priceMode: 'per_inch_max', rateCents: 100 }, { widthIn: 10, heightIn: 30, qty: 2 })).toBe(6000);
  });
  it('cast vinyl: $2/inch of longest side', () => {
    expect(suggestPrice({ priceMode: 'per_inch_max', rateCents: 200 }, { widthIn: 18, heightIn: 6, qty: 1 })).toBe(3600);
  });
  it('banner: $6/sqft', () => {
    // 4×8 ft banner = 48×96 in = 32 sqft → $192
    expect(suggestPrice({ priceMode: 'per_sqft', rateCents: 600 }, { widthIn: 48, heightIn: 96, qty: 1 })).toBe(19200);
  });
  it('same-day shirt w/ blank: flat $24 base per piece', () => {
    const rule = { priceMode: 'per_unit' as const, rateCents: 2400 };
    expect(suggestPrice(rule, { qty: 1 })).toBe(2400);
    expect(suggestPrice(rule, { qty: 3 })).toBe(7200);
  });
  it('customer-provided shirt: $12 base', () => {
    expect(suggestPrice({ priceMode: 'per_unit', rateCents: 1200 }, { qty: 3 })).toBe(3600);
  });
  it('heat transfers: $9/sheet, 2-shirt minimum', () => {
    const rule = { priceMode: 'per_unit' as const, rateCents: 900, minQty: 2 };
    expect(suggestPrice(rule, { qty: 1 })).toBe(1800); // bumped to minimum
    expect(suggestPrice(rule, { qty: 5 })).toBe(4500);
  });
  it('magnets: flat base per piece', () => {
    expect(suggestPrice({ priceMode: 'flat', rateCents: 6500 }, { qty: 2 })).toBe(13000); // 12x18 pair
    expect(suggestPrice({ priceMode: 'flat', rateCents: 7500 }, { qty: 1 })).toBe(7500);  // 12x24
  });
  it('custom mode (aluminum, full-color print): no suggestion', () => {
    expect(suggestPrice({ priceMode: 'custom', rateCents: 0 }, { qty: 1 })).toBeNull();
  });
});

// The complexity surcharge was removed entirely on 2026-07-02 — a line's
// suggested price is now purely rule × qty × color multiplier.

describe('per-line color multiplier', () => {
  it('2 color doubles, 3 color triples — this line only', () => {
    const rule = { priceMode: 'per_inch_max' as const, rateCents: 100, colorMultiplier: true };
    expect(suggestPrice(rule, { widthIn: 10, heightIn: 5, qty: 1, colorMult: 2 })).toBe(2000);
    expect(suggestPrice(rule, { widthIn: 10, heightIn: 5, qty: 1, colorMult: 3 })).toBe(3000);
  });
  it('material can opt out of color multiplier', () => {
    expect(effectiveColorMult({ priceMode: 'flat', rateCents: 6500, colorMultiplier: false }, 3)).toBe(1);
    expect(effectiveColorMult({ priceMode: 'per_inch_max', rateCents: 100 }, 3)).toBe(3);
  });
  it('rounds up to whole dollars', () => {
    // $6/sqft on 10×10in = 0.694 sqft → 416.7¢ → $5
    expect(suggestPrice({ priceMode: 'per_sqft', rateCents: 600 }, { widthIn: 10, heightIn: 10, qty: 1 })).toBe(500);
  });
});

describe('guards', () => {
  it('missing dimensions → null for dimensional modes', () => {
    expect(suggestPrice({ priceMode: 'per_inch_max', rateCents: 100 }, { qty: 1 })).toBeNull();
    expect(suggestPrice({ priceMode: 'per_sqft', rateCents: 600 }, { widthIn: 12, qty: 1 })).toBeNull();
  });
  it('zero rate → null', () => {
    expect(suggestPrice({ priceMode: 'flat', rateCents: 0 }, { qty: 1 })).toBeNull();
  });
});
