import { describe, it, expect } from 'vitest';
import { serverIsOutOfDate, CLIENT_BUILD } from './serverBuild';

describe('serverIsOutOfDate', () => {
  it('matching builds are fine', () => {
    expect(serverIsOutOfDate('abc-1', { build: 'abc-1', version: '0.10.0' })).toBe(false);
  });
  it('a different build means the server was not restarted after an update', () => {
    expect(serverIsOutOfDate('abc-2', { build: 'abc-1' })).toBe(true);
  });
  it('an older server that reports no build at all is out of date', () => {
    expect(serverIsOutOfDate('abc-2', {})).toBe(true);
    expect(serverIsOutOfDate('abc-2', { build: null })).toBe(true);
  });
  it('never warns in development or when the health check failed', () => {
    expect(serverIsOutOfDate('dev', { build: 'abc-1' })).toBe(false);
    expect(serverIsOutOfDate('dev', {})).toBe(false);
    expect(serverIsOutOfDate('abc-2', null)).toBe(false);
  });
  it('tests run as a dev build', () => {
    expect(CLIENT_BUILD).toBe('dev');
  });
});
