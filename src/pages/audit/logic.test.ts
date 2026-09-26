import { describe, it, expect } from 'vitest';
import { prettyJson, changedKeys } from './logic';

describe('prettyJson', () => {
  it('indents JSON and leaves broken text alone', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('<b>not json')).toBe('<b>not json');
    expect(prettyJson(null)).toBe('—');
  });
});

describe('changedKeys', () => {
  it('lists keys that differ, including added and removed', () => {
    expect(changedKeys('{"name":"A","level":0,"x":1}', '{"name":"B","level":0,"y":2}')).toEqual(['name', 'x', 'y']);
  });
  it('treats a create (no before) as all keys changed', () => {
    expect(changedKeys(null, '{"b":1,"a":2}')).toEqual(['a', 'b']);
  });
  it('ignores non-object JSON', () => {
    expect(changedKeys('[1]', 'oops')).toEqual([]);
  });
});
