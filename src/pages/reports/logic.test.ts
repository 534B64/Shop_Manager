import { describe, it, expect } from 'vitest';
import { salesTotals, monthToDate, csvName, type InvoiceHeader } from './logic';

const inv = (p: Partial<InvoiceHeader>): InvoiceHeader => ({ id: 1, subtotalCents: 1000, taxCents: 83, discountCents: 0,
  totalCents: 1083, status: 'issued', returnedCents: 0, ...p });

describe('salesTotals', () => {
  it('adds issued invoices and keeps voided ones apart', () => {
    const t = salesTotals([inv({}), inv({ id: 2, discountCents: 100, totalCents: 983, returnedCents: 500 }),
      inv({ id: 3, status: 'voided', totalCents: 2000 })]);
    expect(t).toMatchObject({ invoices: 2, subtotalCents: 2000, discountCents: 100, taxCents: 166, totalCents: 2066,
      voided: 1, voidedCents: 2000, returnedCents: 500, netCents: 1566 });
  });
  it('is all zeros for no invoices', () => {
    expect(salesTotals([]).netCents).toBe(0);
  });
});

it('monthToDate runs from the 1st to today', () => {
  expect(monthToDate(new Date(2026, 8, 26))).toEqual({ from: '2026-09-01', to: '2026-09-26' });
});

it('csvName labels the range', () => {
  expect(csvName('payments', '2026-09-01', '2026-09-26')).toBe('payments-2026-09-01-to-2026-09-26.csv');
  expect(csvName('payments', '', '')).toBe('payments.csv');
  expect(csvName('payments', '2026-09-01', '')).toBe('payments-2026-09-01-to-today.csv');
});
