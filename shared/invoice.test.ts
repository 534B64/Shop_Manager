import { describe, it, expect } from 'vitest';
import {
  allocate, priceInvoice, lineTaxCents, taxForTotal, returnLineRefund, refundDueCents,
  changeCents, overShortCents, formatInvoiceNumber, parseInvoiceNumber, buildZReport,
} from './invoice';
import { grandTotalCents } from './priceVerify';

describe('per-line tax', () => {
  it('rounds each line half-up and sums lines for the invoice', () => {
    // 8.25% of 1234 = 101.805 → 102; of 999 = 82.4175 → 82.
    expect(lineTaxCents(1234, true, 8.25)).toBe(102);
    expect(lineTaxCents(999, true, 8.25)).toBe(82);
    expect(lineTaxCents(999, false, 8.25)).toBe(0);
    const inv = priceInvoice([
      { qty: 1, subtotalCents: 1234, taxable: true },
      { qty: 3, subtotalCents: 999, taxable: true },
      { qty: 1, subtotalCents: 500, taxable: false },
    ], 8.25);
    expect(inv.lines.map((l) => l.taxCents)).toEqual([102, 82, 0]);
    expect(inv.taxCents).toBe(184);
    expect(inv.subtotalCents).toBe(2733);
    expect(inv.totalCents).toBe(2733 + 184);
    expect(inv.lines[2].taxRatePct).toBe(0);
  });

  it('matches the job grand total for a one-line invoice, discount included', () => {
    for (const [price, pct] of [[10000, 0], [4599, 10], [123457, 15], [1, 5]] as const) {
      const inv = priceInvoice([{ qty: 4, subtotalCents: price, taxable: true }], 8.25, pct);
      expect(inv.totalCents).toBe(grandTotalCents(price, true, 8.25, pct));
    }
  });

  it('allocates the after-tax discount to lines so they sum to the invoice', () => {
    const inv = priceInvoice([
      { qty: 1, subtotalCents: 333, taxable: true },
      { qty: 1, subtotalCents: 333, taxable: true },
      { qty: 1, subtotalCents: 334, taxable: false },
    ], 7, 10);
    expect(inv.lines.reduce((s, l) => s + l.discountCents, 0)).toBe(inv.discountCents);
    expect(inv.lines.reduce((s, l) => s + l.totalCents, 0)).toBe(inv.totalCents);
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('taxForTotal (pre-Phase-3 jobs)', () => {
  it('finds the tax that reproduces a stored total', () => {
    const total = grandTotalCents(10000, true, 7, 10);
    const r = taxForTotal(10000, 10, total);
    expect(10000 + r.taxCents - r.discountCents).toBe(total);
    expect(r.taxCents).toBe(700);
  });
});

describe('return refunds', () => {
  const line = { qty: 3, subtotalCents: 1000, taxCents: 83, discountCents: 0 };
  it('pro-rates each part and lands exactly on the line after full return', () => {
    const a = returnLineRefund(line, 0, 1)!;
    const b = returnLineRefund(line, 1, 1)!;
    const c = returnLineRefund(line, 2, 1)!;
    expect(a.subtotalCents + b.subtotalCents + c.subtotalCents).toBe(1000);
    expect(a.taxCents + b.taxCents + c.taxCents).toBe(83);
    expect(a.totalCents).toBe(a.subtotalCents + a.taxCents);
  });
  it('refuses more than was sold, or a non-positive qty', () => {
    expect(returnLineRefund(line, 2, 2)).toBeNull();
    expect(returnLineRefund(line, 0, 0)).toBeNull();
    expect(returnLineRefund(line, 0, 1.5)).toBeNull();
  });
  it('only refunds what the customer overpaid', () => {
    // Paid in full: the whole return comes back.
    expect(refundDueCents({ returnCents: 300, invoiceTotalCents: 1000, returnedBeforeCents: 0, paidNetCents: 1000 })).toBe(300);
    // Nothing paid yet: the return just lowers the balance.
    expect(refundDueCents({ returnCents: 300, invoiceTotalCents: 1000, returnedBeforeCents: 0, paidNetCents: 0 })).toBe(0);
    // Paid 800 of 1000, return 300 → owes 700, paid 800 → refund 100.
    expect(refundDueCents({ returnCents: 300, invoiceTotalCents: 1000, returnedBeforeCents: 0, paidNetCents: 800 })).toBe(100);
  });
});

describe('cash + drawer helpers', () => {
  it('computes change and over/short', () => {
    expect(changeCents(1850, 2000)).toBe(150);
    expect(changeCents(1850, 1000)).toBeNull();
    expect(overShortCents(10000, 9950)).toBe(-50);
    expect(overShortCents(10000, 10025)).toBe(25);
  });
  it('formats and parses invoice numbers', () => {
    expect(formatInvoiceNumber(42)).toBe('000042');
    expect(parseInvoiceNumber('000042')).toBe(42);
    expect(parseInvoiceNumber('0')).toBeNull();
    expect(parseInvoiceNumber('abc')).toBeNull();
  });
  it('builds a Z-report: totals by method, expected cash, over/short', () => {
    const z = buildZReport({
      openingFloatCents: 10000,
      payments: [
        { method: 'cash', kind: 'payment', amountCents: 2500, voided: false },
        { method: 'cash', kind: 'refund', amountCents: 500, voided: false },
        { method: 'card', kind: 'payment', amountCents: 4000, voided: false },
        { method: 'check', kind: 'payment', amountCents: 1500, voided: false },
        { method: 'cash', kind: 'payment', amountCents: 9999, voided: true },
      ],
      invoices: [
        { number: 7, subtotalCents: 3000, taxCents: 248, discountCents: 0, totalCents: 3248 },
        { number: 8, subtotalCents: 4000, taxCents: 0, discountCents: 0, totalCents: 4000 },
      ],
      voids: [{ invoiceTotalCents: 4000, invoiceTaxCents: 0, refundCents: 4000 }],
      returns: [{ totalCents: 500, taxCents: 38, refundCents: 500 }],
      countedCashCents: 11950,
      countedChecksCents: 1500,
    });
    expect(z.byMethod.cash).toEqual({ count: 2, paymentsCents: 2500, refundsCents: 500, netCents: 2000 });
    expect(z.voidedPayments).toEqual({ count: 1, cents: 9999 });
    expect(z.cash).toEqual({ expectedCents: 12000, countedCents: 11950, overShortCents: -50 });
    expect(z.checks.overShortCents).toBe(0);
    expect(z.sales).toMatchObject({ invoiceCount: 2, firstNumber: '000007', lastNumber: '000008', taxCents: 248 });
    expect(z.netSalesCents).toBe(7248 - 4000 - 500);
    expect(z.netTaxCents).toBe(248 - 38);
  });
});
