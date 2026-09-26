import { describe, it, expect } from 'vitest';
import { pinError, newPinErrors, numberIn, rateLabel, addUnique, visibleRows } from './logic';

describe('PIN rules', () => {
  it('accepts 4–12 digits only', () => {
    expect(pinError('1234')).toBeNull();
    expect(pinError('123')).toBeTruthy();
    expect(pinError('12ab')).toBeTruthy();
    expect(pinError('1234567890123')).toBeTruthy();
  });
  it('checks the repeat only after the PIN itself is valid', () => {
    expect(newPinErrors('12', '12')).toEqual({ next: 'PIN must be 4–12 digits.' });
    expect(newPinErrors('1234', '1235')).toEqual({ repeat: 'The PINs don’t match.' });
    expect(newPinErrors('1234', '1234')).toEqual({});
  });
});

describe('numberIn', () => {
  it('parses in-range numbers and refuses the rest', () => {
    expect(numberIn('8.25', 0, 30)).toBe(8.25);
    expect(numberIn(' 0 ', 0, 30)).toBe(0);
    expect(numberIn('', 0, 30)).toBeNull();
    expect(numberIn('-1', 0, 30)).toBeNull();
    expect(numberIn('31', 0, 30)).toBeNull();
    expect(numberIn('1e3', 0, 5000)).toBeNull();
  });
});

it('rateLabel names the unit of each price mode', () => {
  expect(rateLabel('per_sqft')).toBe('$ per sq ft');
  expect(rateLabel('custom')).toBe('$');
});

it('addUnique ignores blanks and case-insensitive duplicates', () => {
  expect(addUnique(['roll'], ' Sheet ')).toEqual(['roll', 'Sheet']);
  expect(addUnique(['roll'], 'ROLL')).toEqual(['roll']);
  expect(addUnique(['roll'], '  ')).toEqual(['roll']);
});

it('visibleRows hides archived unless asked and filters by name', () => {
  const rows = [{ name: 'Fellers' }, { name: 'Grimco', archivedAt: '2026-01-01' }, { name: 'Fell Co' }];
  expect(visibleRows(rows, false).map((r) => r.name)).toEqual(['Fellers', 'Fell Co']);
  expect(visibleRows(rows, true, 'grim').map((r) => r.name)).toEqual(['Grimco']);
});
