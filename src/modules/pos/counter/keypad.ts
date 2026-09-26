// Cash-tendered keypad: cash-register entry — digits fill from the right, so
// 2 0 0 0 reads $20.00. The state is the digit string; money stays in cents.

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | 'back' | 'clear';

export const MAX_DIGITS = 7; // $99,999.99

export function keypadPress(digits: string, key: KeypadKey): string {
  if (key === 'clear') return '';
  if (key === 'back') return digits.slice(0, -1);
  const next = (digits + key).replace(/^0+/, '');
  return next.length > MAX_DIGITS ? digits : next;
}

export const digitsToCents = (digits: string): number => (digits ? Number(digits) : 0);
export const centsToDigits = (cents: number): string => (cents > 0 ? String(Math.round(cents)) : '');

/**
 * One-tap tender amounts for a total: exact, then the next whole dollar and the
 * next $5/$10/$20/$50/$100 at or above it — deduped, ascending, at most `max`.
 */
export function quickTenders(totalCents: number, max = 5): number[] {
  if (totalCents <= 0) return [];
  const up = (step: number) => Math.ceil(totalCents / step) * step;
  const set = new Set<number>([totalCents, up(100), up(500), up(1000), up(2000), up(5000), up(10000)]);
  return [...set].sort((a, b) => a - b).slice(0, max);
}
