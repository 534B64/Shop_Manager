import { describe, it, expect } from 'vitest';
import { serverIsOutOfDate, serverState, buildTime, CLIENT_BUILD } from './serverBuild';

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

  it('parses the build time from the id', () => {
    expect(buildTime('abc1234-mum41ij8')).toBe(parseInt('mum41ij8', 36));
    expect(buildTime('nogit-mum41ij8')).toBe(parseInt('mum41ij8', 36));
    expect(buildTime('dev')).toBeNull();
    expect(buildTime(null)).toBeNull();
  });
  it('server NEWER than the page (tab opened before a restart) -> reload, not restart', () => {
    expect(serverState('abc-mum41ij8', { build: 'def-mum42000' })).toBe('server-newer');
    expect(serverIsOutOfDate('abc-mum41ij8', { build: 'def-mum42000' })).toBe(false);
  });
  it('server OLDER than the page, or no build at all -> restart message', () => {
    expect(serverState('def-mum42000', { build: 'abc-mum41ij8' })).toBe('server-older');
    expect(serverState('def-mum42000', {})).toBe('server-older');
    expect(serverState('def-mum42000', { build: 'garbage' })).toBe('server-older');
  });
  it('same build, dev, or failed check -> ok', () => {
    expect(serverState('abc-mum41ij8', { build: 'abc-mum41ij8' })).toBe('ok');
    expect(serverState('dev', { build: 'x-1' })).toBe('ok');
    expect(serverState('abc-mum41ij8', null)).toBe('ok');
  });
});
