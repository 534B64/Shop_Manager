import { describe, it, expect } from 'vitest';
import { previewReturn, remainingQty, canRestock, paidNetCents, toReturnLines } from './plan';
import type { InvoiceDetail, InvoiceLine } from '../types';

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  id: 1, lineNo: 1, description: 'A', qty: 3, unitPriceCents: 1000, subtotalCents: 3000, suggestedCents: null,
  taxable: true, taxRatePct: 8.25, taxCents: 248, discountCents: 0, totalCents: 3248,
  inventoryItemId: null, stockQty: 0, returnedQty: 0, ...over,
});

const invoice = (lines: InvoiceLine[], paid: number, returnedCents = 0): InvoiceDetail => ({
  id: 9, number: 12, numberDisplay: '000012', jobId: 4, customerId: null, customerName: null, jobPo: null, title: 'T',
  source: 'counter_sale', taxRatePct: 8.25, taxExempt: false, taxExemptReason: null, subtotalCents: 0, taxCents: 0, discountPct: 0, discountCents: 0,
  totalCents: lines.reduce((s, l) => s + l.totalCents, 0), drawerSessionId: null, createdBy: null, createdAt: '',
  status: 'issued', returnedCents, lines, void: null, returns: [],
  payments: paid ? [{ id: 1, jobId: 4, amountCents: paid, method: 'card', kind: 'payment', voidedAt: null, voidReason: null, note: null,
    createdAt: '', drawerSessionId: null, tenderedCents: null, changeCents: null, returnId: null, invoiceVoidId: null }] : [],
});

describe('return preview', () => {
  it('knows what is left and what can be restocked', () => {
    expect(remainingQty(line({ qty: 3, returnedQty: 1 }))).toBe(2);
    expect(canRestock(line({}))).toBe(false);
    expect(canRestock(line({ inventoryItemId: 5 }))).toBe(true);
  });

  it('adds up net paid ignoring voided rows', () => {
    expect(paidNetCents([
      { kind: 'payment', amountCents: 1000, voidedAt: null }, { kind: 'refund', amountCents: 300, voidedAt: null },
      { kind: 'payment', amountCents: 999, voidedAt: '2026-01-01' },
    ])).toBe(700);
  });

  it('values lines pro-rata (pieces sum to the line) and refunds a paid invoice in full', () => {
    const l = line({ inventoryItemId: 5 });
    const inv = invoice([l], 3248);
    const one = previewReturn(inv, { 1: { qty: 1, restock: true } });
    expect(one.totalCents).toBe(1000 + 83);
    expect(one.refundCents).toBe(one.totalCents);
    expect(one.lines[0].restock).toBe(true);
    expect(toReturnLines(one)).toEqual([{ invoiceLineId: 1, qty: 1, restock: true }]);
    const rest = previewReturn(invoice([{ ...l, returnedQty: 1 }], 3248, one.totalCents), { 1: { qty: 2, restock: false } });
    expect(one.totalCents + rest.totalCents).toBe(3248);
    expect(toReturnLines(rest)).toEqual([{ invoiceLineId: 1, qty: 2 }]);
  });

  it('refunds nothing when the invoice is unpaid (the return just lowers the balance)', () => {
    const p = previewReturn(invoice([line({})], 0), { 1: { qty: 1, restock: false } });
    expect(p.totalCents).toBeGreaterThan(0);
    expect(p.refundCents).toBe(0);
  });

  it('never restocks a non-stock line and flags too many', () => {
    const p = previewReturn(invoice([line({})], 3248), { 1: { qty: 4, restock: true } });
    expect(p.invalid).toBe(true);
    const q = previewReturn(invoice([line({})], 3248), { 1: { qty: 1, restock: true } });
    expect(q.lines[0].restock).toBe(false);
  });
});
