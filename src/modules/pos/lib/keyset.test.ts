import { describe, it, expect } from 'vitest';
import { firstPage, cursorOf, nextPage, prevPage } from './keyset';

describe('keyset cursors', () => {
  it('starts on page 1 with no cursor, walks forward and back', () => {
    let c = firstPage();
    expect(cursorOf(c)).toBeNull();
    c = nextPage(c, 40);
    c = nextPage(c, 15);
    expect(cursorOf(c)).toBe(15);
    expect(c.stack).toHaveLength(3);
    c = prevPage(c);
    expect(cursorOf(c)).toBe(40);
    c = prevPage(prevPage(c));
    expect(cursorOf(c)).toBeNull();
  });

  it('does not advance past the last page', () => {
    const c = firstPage();
    expect(nextPage(c, null)).toBe(c);
  });
});
