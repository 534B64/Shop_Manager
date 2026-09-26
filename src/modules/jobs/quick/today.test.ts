import { describe, it, expect } from 'vitest';
import { startOfToday } from './TodaySales';

describe('startOfToday', () => {
  it('is local midnight of the given day, as an ISO timestamp', () => {
    const d = new Date(startOfToday(new Date(2026, 8, 26, 21, 30)));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 26, 0, 0]);
  });
});
