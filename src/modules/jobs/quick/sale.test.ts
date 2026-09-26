import { describe, it, expect } from 'vitest';
import { saleBody, quickTotals, type SaleForm } from './sale';
import { priceCounterSale } from '../../../../shared/invoice';

const form = (over: Partial<SaleForm> = {}): SaleForm => ({
  clientRef: 'ref-12345678', customerId: 4, title: ' Flag decal ', amount: '12.50', method: 'cash', stockItemId: null, stockQty: '1', ...over,
});

describe('saleBody', () => {
  it('builds the counter-sale body, adding stock only when linked', () => {
    expect(saleBody(form())).toEqual({ body: { clientRef: 'ref-12345678', title: 'Flag decal', amountCents: 1250, method: 'cash', customerId: 4 } });
    expect(saleBody(form({ stockItemId: 9, stockQty: '2.4' }))).toMatchObject({ body: { inventoryItemId: 9, stockQty: 2 } });
    expect(saleBody(form({ stockItemId: 9, stockQty: 'x' }))).toMatchObject({ body: { stockQty: 1 } });
  });
  it('explains what is missing', () => {
    expect(saleBody(form({ customerId: null }))).toEqual({ error: expect.stringMatching(/Walk-in/) });
    expect(saleBody(form({ title: ' ' }))).toEqual({ error: expect.any(String) });
    expect(saleBody(form({ amount: '0' }))).toEqual({ error: expect.stringMatching(/amount/) });
    expect(saleBody(form({ amount: 'abc' }))).toEqual({ error: expect.stringMatching(/amount/) });
  });
  it('a tax-exempt sale needs a reason and sends it (D10)', () => {
    expect(saleBody(form({ exempt: { on: true, reason: '' } }))).toEqual({ error: expect.stringMatching(/say why/) });
    expect(saleBody(form({ exempt: { on: true, reason: ' Nonprofit ' } })))
      .toMatchObject({ body: { taxExempt: true, taxExemptReason: 'Nonprofit' } });
    const off = saleBody(form({ exempt: { on: false, reason: 'Nonprofit' } })) as { body: Record<string, unknown> };
    expect(off.body).not.toHaveProperty('taxExempt');
  });
});

describe('quickTotals', () => {
  it('adds tax to the amount rung up, exactly as the server prices it', () => {
    const t = quickTotals('12.50', 8.25, false)!;
    expect(t).toMatchObject({ subtotalCents: 1250, taxCents: 103, totalCents: 1353 });
    expect(t).toEqual(priceCounterSale([{ qty: 1, subtotalCents: 1250 }], 8.25));
  });
  it('an exempt sale is the amount; no amount → null', () => {
    expect(quickTotals('12.50', 8.25, true)).toMatchObject({ taxCents: 0, totalCents: 1250 });
    expect(quickTotals('', 8.25, false)).toBeNull();
  });
});
