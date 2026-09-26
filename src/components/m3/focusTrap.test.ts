import { describe, it, expect } from 'vitest';
import { nextTrapFocus } from './Dialog';

describe('dialog focus trap', () => {
  const items = ['name', 'pin', 'cancel', 'approve'];
  it('wraps Tab from the last item to the first, and Shift+Tab from the first to the last', () => {
    expect(nextTrapFocus(items, 'approve', false, true)).toBe('name');
    expect(nextTrapFocus(items, 'name', true, true)).toBe('approve');
  });
  it('lets the browser move between items in the middle', () => {
    expect(nextTrapFocus(items, 'pin', false, true)).toBeNull();
    expect(nextTrapFocus(items, 'cancel', true, true)).toBeNull();
  });
  it('pulls focus back in when it escaped to the page behind', () => {
    expect(nextTrapFocus(items, 'page-link', false, false)).toBe('name');
    expect(nextTrapFocus(items, null, true, false)).toBe('approve');
  });
  it('has nowhere to go with no focusable items', () => {
    expect(nextTrapFocus([], null, false, false)).toBeNull();
  });
});
