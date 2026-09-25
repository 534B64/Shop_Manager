import { describe, it, expect } from 'vitest';
import { nextStatus, prevStatus, canTransition, pathFor } from './statusFlow';

describe('status flow — simple path', () => {
  it('walks acknowledged → in_progress → done → picked_up', () => {
    expect(nextStatus('acknowledged', false)).toBe('in_progress');
    expect(nextStatus('in_progress', false)).toBe('done');
    expect(nextStatus('done', false)).toBe('picked_up');
    expect(nextStatus('picked_up', false)).toBeNull();
  });
  it('steps back one', () => {
    expect(prevStatus('done', false)).toBe('in_progress');
    expect(prevStatus('acknowledged', false)).toBeNull();
  });
  it('quote is not on the simple path', () => {
    expect(pathFor(false)).not.toContain('quote');
    expect(nextStatus('quote', false)).toBeNull();
  });
});

describe('status flow — proof path', () => {
  it('walks quote → approved → design → in_production → done → picked_up', () => {
    expect(nextStatus('quote', true)).toBe('approved');
    expect(nextStatus('approved', true)).toBe('design');
    expect(nextStatus('design', true)).toBe('in_progress');
    expect(nextStatus('picked_up', true)).toBeNull();
  });
});

describe('canTransition', () => {
  it('allows one step forward or back only', () => {
    expect(canTransition('acknowledged', 'in_progress', false)).toBe(true);
    expect(canTransition('in_progress', 'acknowledged', false)).toBe(true);
    expect(canTransition('acknowledged', 'done', false)).toBe(false);
    expect(canTransition('acknowledged', 'picked_up', false)).toBe(false);
    expect(canTransition('quote', 'design', true)).toBe(false);
  });
});
