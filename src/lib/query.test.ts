import { describe, it, expect } from 'vitest';
import { withParams, pageInfo } from './query';

describe('withParams', () => {
  it('skips empty values and encodes the rest', () => {
    expect(withParams('/api/inventory', { q: 'red vinyl', limit: 25, offset: 0, low: true, kind: '', x: null, y: undefined, z: false }))
      .toBe('/api/inventory?q=red+vinyl&limit=25&offset=0&low=1');
  });
  it('appends to an existing query string', () => {
    expect(withParams('/api/jobs?status=done', { limit: 10 })).toBe('/api/jobs?status=done&limit=10');
    expect(withParams('/api/jobs', {})).toBe('/api/jobs');
  });
});

describe('pageInfo', () => {
  it('first, middle, last and empty pages', () => {
    expect(pageInfo(0, 25, 60)).toEqual({ pageCount: 3, from: 1, to: 25, hasPrev: false, hasNext: true });
    expect(pageInfo(1, 25, 60)).toEqual({ pageCount: 3, from: 26, to: 50, hasPrev: true, hasNext: true });
    expect(pageInfo(2, 25, 60)).toEqual({ pageCount: 3, from: 51, to: 60, hasPrev: true, hasNext: false });
    expect(pageInfo(0, 25, 0)).toEqual({ pageCount: 1, from: 0, to: 0, hasPrev: false, hasNext: false });
  });
});
