import { describe, it, expect } from 'vitest';
import { cursorStack } from './keysetPaging';
import { errorText, approvalCancelled } from './errorText';
import { ApiError } from './api';

describe('cursorStack', () => {
  it('pushes the next cursor and pops back to the first page', () => {
    let s: (number | null)[] = [null];
    s = cursorStack.next(s, 90);
    s = cursorStack.next(s, 40);
    expect(s).toEqual([null, 90, 40]);
    s = cursorStack.prev(s);
    expect(s).toEqual([null, 90]);
    expect(cursorStack.prev(cursorStack.prev(s))).toEqual([null]);
  });
  it('does not move past the last page', () => {
    expect(cursorStack.next([null, 5], null)).toEqual([null, 5]);
  });
});

describe('errorText', () => {
  it('prefers the server message, then the error text', () => {
    expect(errorText(new ApiError(400, 'bad_paging', { message: 'limit must be…' }))).toBe('limit must be…');
    expect(errorText(new ApiError(409, 'This is the last active admin'))).toBe('This is the last active admin');
    expect(errorText(new Error('Failed to fetch'))).toMatch(/wifi/);
    expect(errorText('x', 'Nope')).toBe('Nope');
  });
  it('spots a cancelled approval', () => {
    expect(approvalCancelled(new ApiError(403, 'Manager approval cancelled'))).toBe(true);
    expect(approvalCancelled(new Error('Manager approval cancelled'))).toBe(false);
  });
});
