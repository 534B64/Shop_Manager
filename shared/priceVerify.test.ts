import { describe, it, expect } from 'vitest';
import { combinedSuggestedCents, grandTotalCents, type VerifyLine } from './priceVerify';

const perInch = { priceMode: 'per_inch_max', rateCents: 100 } as const; // $1/in
const flat = { priceMode: 'flat', rateCents: 6500 } as const; // $65 magnets
const custom = { priceMode: 'custom', rateCents: 0 } as const;

describe('combinedSuggestedCents', () => {
  it('sums main + item lines like the client does', () => {
    const lines: VerifyLine[] = [
      { rule: perInch, widthIn: 10, heightIn: 4, qty: 2 }, // 100×10×2 → $20
      { rule: flat, qty: 1 }, // $65
    ];
    expect(combinedSuggestedCents(lines)).toBe(2000 + 6500);
  });

  it('skips custom / unknown-rule lines instead of failing', () => {
    const lines: VerifyLine[] = [
      { rule: custom, widthIn: 10, heightIn: 4, qty: 1 },
      { rule: null, qty: 3 },
      { rule: flat, qty: 1 },
    ];
    expect(combinedSuggestedCents(lines)).toBe(6500);
  });

  it('returns null when nothing is priceable (mirrors anySuggestion=false)', () => {
    expect(combinedSuggestedCents([{ rule: custom, qty: 1 }, { rule: null, qty: 1 }])).toBeNull();
    expect(combinedSuggestedCents([])).toBeNull();
  });
});

describe('grandTotalCents', () => {
  it('adds tax on taxable jobs (default 8.25%)', () => {
    // $100 → tax $8.25 → $108.25
    expect(grandTotalCents(10000, true, 8.25, 0)).toBe(10825);
  });

  it('skips tax when not taxable', () => {
    expect(grandTotalCents(10000, false, 8.25, 0)).toBe(10000);
  });

  it('applies the level discount AFTER tax, both rounded like the client', () => {
    // $100 + $8.25 tax = $108.25 → −10% = −$10.83 (rounded) → $97.42
    expect(grandTotalCents(10000, true, 8.25, 10)).toBe(10825 - 1083);
  });

  it('matches client rounding on awkward amounts', () => {
    // $45.55 @ 8.25% → tax 375.7875 → 376; total 4931
    expect(grandTotalCents(4555, true, 8.25, 0)).toBe(4931);
    // then 5% discount: (4931) × 5% = 246.55 → 247 → 4684
    expect(grandTotalCents(4555, true, 8.25, 5)).toBe(4931 - 247);
  });
});
