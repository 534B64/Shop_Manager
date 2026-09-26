import { describe, it, expect } from 'vitest';
import {
  addFreeLine, addStockLine, setQty, setPrice, setTaxable, removeLine, cartTotals, cartProblems,
  toSaleLines, isOverride, clampQty, type CartLine,
} from './cart';
import { priceInvoice } from '../../../../shared/invoice';
import { keypadPress, digitsToCents, centsToDigits, quickTenders } from './keypad';

describe('cart operations', () => {
  it('adds free lines and stock lines; the same stock item bumps qty instead of a new line', () => {
    let c: CartLine[] = [];
    c = addFreeLine(c, '  Custom decal ', 1500, true);
    c = addStockLine(c, { id: 7, name: 'Flag 5in', count: 3 }, false);
    c = addStockLine(c, { id: 7, name: 'Flag 5in', count: 3 }, false);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ description: 'Custom decal', qty: 1, unitPriceCents: 1500, taxable: true });
    expect(c[1]).toMatchObject({ inventoryItemId: 7, qty: 2, unitPriceCents: null, onHand: 3 });
    expect(new Set(c.map((l) => l.key)).size).toBe(2);
  });

  it('clamps qty to 1..9999 and edits price / tax / removes', () => {
    let c = addFreeLine([], 'A', 100, false);
    const k = c[0].key;
    expect(setQty(c, k, 0)[0].qty).toBe(1);
    expect(setQty(c, k, 20000)[0].qty).toBe(9999);
    expect(clampQty(NaN)).toBe(1);
    c = setTaxable(setPrice(c, k, 250), k, true);
    expect(c[0]).toMatchObject({ unitPriceCents: 250, taxable: true });
    expect(removeLine(c, k)).toEqual([]);
  });

  it('totals match the server pricing exactly (per-line tax, half-up)', () => {
    let c = addFreeLine([], 'A', 333, true);
    c = setQty(c, c[0].key, 3);
    c = addFreeLine(c, 'B', 1005, true);
    c = addFreeLine(c, 'C', 500, false);
    const t = cartTotals(c, 8.25);
    const server = priceInvoice([{ qty: 3, subtotalCents: 999, taxable: true }, { qty: 1, subtotalCents: 1005, taxable: true },
      { qty: 1, subtotalCents: 500, taxable: false }], 8.25, 0);
    expect(t).toEqual(server);
    expect(t.lines.map((l) => l.taxCents)).toEqual([82, 83, 0]);
    expect(t.totalCents).toBe(999 + 1005 + 500 + 165);
  });

  it('lists what blocks the sale', () => {
    expect(cartProblems([], 0)).toEqual(['Add an item to the sale.']);
    const c = addStockLine([], { id: 1, name: 'Tape' }, false);
    expect(cartProblems(c, 0)[0]).toMatch(/Enter a price for Tape/);
    const free = setPrice(c, c[0].key, 0);
    expect(cartProblems(free, 0)).toEqual(['The sale must be more than $0.00.']);
    expect(cartProblems(setPrice(c, c[0].key, 100), 100)).toEqual([]);
  });

  it('flags a price override only when a suggestion exists and differs', () => {
    const base: CartLine = { key: 'x', description: 'X', qty: 1, unitPriceCents: 900, taxable: false };
    expect(isOverride(base)).toBe(false);
    expect(isOverride({ ...base, suggestedUnitPriceCents: 900 })).toBe(false);
    expect(isOverride({ ...base, suggestedUnitPriceCents: 1000 })).toBe(true);
  });

  it('builds sale lines for the API (only the fields it accepts)', () => {
    let c = addStockLine([], { id: 4, name: 'Magnet' }, true);
    c = setPrice(c, c[0].key, 1200);
    c = addFreeLine(c, 'Labor', 2500, false);
    expect(toSaleLines(c)).toEqual([
      { description: 'Magnet', qty: 1, unitPriceCents: 1200, taxable: true, inventoryItemId: 4 },
      { description: 'Labor', qty: 1, unitPriceCents: 2500, taxable: false },
    ]);
  });
});

describe('cash keypad', () => {
  it('fills from the right like a register', () => {
    let d = '';
    for (const k of ['2', '0', '0', '0'] as const) d = keypadPress(d, k);
    expect(digitsToCents(d)).toBe(2000);
    expect(digitsToCents(keypadPress(d, 'back'))).toBe(200);
    expect(keypadPress(d, 'clear')).toBe('');
    expect(digitsToCents(keypadPress('5', '00'))).toBe(500);
  });

  it('ignores leading zeros and caps the length', () => {
    expect(keypadPress('', '0')).toBe('');
    expect(keypadPress('', '00')).toBe('');
    expect(keypadPress('1234567', '8')).toBe('1234567');
    expect(digitsToCents('')).toBe(0);
    expect(centsToDigits(1250)).toBe('1250');
    expect(centsToDigits(0)).toBe('');
  });

  it('suggests exact and round-up tenders', () => {
    expect(quickTenders(1234)).toEqual([1234, 1300, 1500, 2000, 5000]);
    expect(quickTenders(2000)).toEqual([2000, 5000, 10000]);
    expect(quickTenders(0)).toEqual([]);
  });
});
