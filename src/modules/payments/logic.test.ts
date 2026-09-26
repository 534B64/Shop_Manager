import { describe, it, expect } from 'vitest';
import { overpayCents, checkPayment } from './logic';
import { lastDays, todayIso } from '../pos/lib/when';

describe('payments page rules', () => {
  it('measures an overpayment', () => {
    expect(overpayCents(1500, 1000)).toBe(500);
    expect(overpayCents(900, 1000)).toBe(0);
  });

  it('checks amount, and cash tendered + change', () => {
    expect(checkPayment('', 'card', '').problem).toMatch(/amount/);
    expect(checkPayment('0', 'card', '').problem).toMatch(/amount/);
    expect(checkPayment('12.50', 'card', '99')).toEqual({ amountCents: 1250, tenderedCents: null, change: null, problem: null });
    expect(checkPayment('12.50', 'cash', '')).toEqual({ amountCents: 1250, tenderedCents: null, change: null, problem: null });
    expect(checkPayment('12.50', 'cash', '20')).toEqual({ amountCents: 1250, tenderedCents: 2000, change: 750, problem: null });
    expect(checkPayment('12.50', 'cash', '10').problem).toMatch(/less/);
    expect(checkPayment('12.50', 'cash', 'abc').problem).toMatch(/isn’t/);
  });

  it('builds date ranges ending today', () => {
    const now = new Date('2026-09-26T15:00:00Z');
    expect(todayIso(now)).toBe('2026-09-26');
    expect(lastDays(1, now)).toEqual({ from: '2026-09-26', to: '2026-09-26' });
    expect(lastDays(7, now)).toEqual({ from: '2026-09-20', to: '2026-09-26' });
  });
});
