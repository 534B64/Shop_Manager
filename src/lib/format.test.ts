import { describe, it, expect } from 'vitest';
import { formatCents, parseDollarsToCents } from './format';

describe('formatCents', () => {
  it('formats whole dollars', () => expect(formatCents(15000)).toBe('$150.00'));
  it('formats cents', () => expect(formatCents(85)).toBe('$0.85'));
  it('formats zero', () => expect(formatCents(0)).toBe('$0.00'));
  it('formats thousands with separator', () => expect(formatCents(123456789)).toBe('$1,234,567.89'));
});

describe('parseDollarsToCents', () => {
  it('parses plain number', () => expect(parseDollarsToCents('12')).toBe(1200));
  it('parses with dollar sign and commas', () => expect(parseDollarsToCents('$1,200.50')).toBe(120050));
  it('parses cents-only decimals', () => expect(parseDollarsToCents('0.85')).toBe(85));
  it('rejects garbage', () => expect(parseDollarsToCents('abc')).toBeNull());
  it('rejects three decimal places', () => expect(parseDollarsToCents('1.005')).toBeNull());
  it('rejects empty', () => expect(parseDollarsToCents('')).toBeNull());
});
