import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { newRef } from './ref';

const getRandomValues = <T extends ArrayBufferView | null>(a: T) => webcrypto.getRandomValues(a as Uint8Array) as unknown as T;

describe('newRef (clientRef / id)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses randomUUID when the browser has it (secure origin)', () => {
    expect(newRef()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('falls back to getRandomValues on plain-http LAN origins (no randomUUID)', () => {
    vi.stubGlobal('crypto', { getRandomValues });
    const a = newRef();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newRef()).not.toBe(a);
  });
  it('falls back when randomUUID exists but throws', () => {
    vi.stubGlobal('crypto', { getRandomValues, randomUUID: () => { throw new Error('insecure context'); } });
    expect(newRef()).toMatch(/^[0-9a-f]{32}$/);
  });
});
