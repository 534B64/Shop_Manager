import { describe, it, expect } from 'vitest';
import { saleBody, type SaleForm } from './sale';

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
});
