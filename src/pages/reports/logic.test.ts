import { describe, it, expect } from 'vitest';
import { monthToDate, csvName } from './logic';

it('monthToDate runs from the 1st to today', () => {
  expect(monthToDate(new Date(2026, 8, 26))).toEqual({ from: '2026-09-01', to: '2026-09-26' });
});

it('csvName labels the range', () => {
  expect(csvName('payments', '2026-09-01', '2026-09-26')).toBe('payments-2026-09-01-to-2026-09-26.csv');
  expect(csvName('payments', '', '')).toBe('payments.csv');
  expect(csvName('payments', '2026-09-01', '')).toBe('payments-2026-09-01-to-today.csv');
});
