import { describe, it, expect } from 'vitest';
import { dueSoon, localIsoDate, splitTags, tagColor } from './logic';
import type { Job } from '../../lib/types';

const job = (id: number, dueDate: string | null, status = 'in_progress') => ({ id, dueDate, status, title: `Job ${id}` }) as Job;

describe('dashboard logic', () => {
  const now = new Date(2026, 8, 26, 21, 0); // 9pm local — UTC may already be tomorrow

  it('uses the local date', () => {
    expect(localIsoDate(now)).toBe('2026-09-26');
  });

  it('dueSoon keeps open jobs due within a week, soonest first, with state', () => {
    const rows = dueSoon([
      job(1, '2026-10-02'), job(2, '2026-09-20'), job(3, '2026-09-26'), job(4, '2026-10-10'),
      job(5, '2026-09-21', 'done'), job(6, null), job(7, '2026-09-22', 'picked_up'),
    ], now);
    expect(rows.map((r) => [r.id, r.due])).toEqual([[2, 'overdue'], [3, 'today'], [1, 'soon']]);
  });

  it('tags split and color stably', () => {
    expect(splitTags(' rush, ,vip ')).toEqual(['rush', 'vip']);
    expect(tagColor('rush')).toBe(tagColor('rush'));
  });
});
