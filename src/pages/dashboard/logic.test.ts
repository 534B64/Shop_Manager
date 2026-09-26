import { describe, it, expect } from 'vitest';
import { dueState, localIsoDate, splitTags, tagColor } from './logic';

describe('dashboard logic', () => {
  const now = new Date(2026, 8, 26, 21, 0); // 9pm local — UTC may already be tomorrow

  it('uses the local date', () => {
    expect(localIsoDate(now)).toBe('2026-09-26');
  });

  it('dueState grades a due date against the local day', () => {
    const today = localIsoDate(now);
    expect(dueState('2026-09-20', today)).toBe('overdue');
    expect(dueState('2026-09-26', today)).toBe('today');
    expect(dueState('2026-10-02', today)).toBe('soon');
  });

  it('tags split and color stably', () => {
    expect(splitTags(' rush, ,vip ')).toEqual(['rush', 'vip']);
    expect(tagColor('rush')).toBe(tagColor('rush'));
  });
});
