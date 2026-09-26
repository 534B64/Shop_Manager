// Date-only filters mean the shop's local day (server/lib/dates.ts), not the
// UTC day: an 8 pm sale in Chicago is stored as 01:00Z the next day and must
// still count on the day it was rung up. TZ is set before any Date is made.
process.env.TZ = 'America/Chicago';

import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';
import { localDayRange, localDayStart, localDayEnd } from './lib/dates.js';

let app: FastifyInstance;
let dbFile: string;

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-days-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('localDayRange (TZ=America/Chicago)', () => {
  it('turns local days into UTC bounds, the end exclusive', () => {
    expect(localDayStart('2026-09-26')).toBe('2026-09-26T05:00:00.000Z'); // CDT = UTC−5
    expect(localDayEnd('2026-09-26')).toBe('2026-09-27T05:00:00.000Z');
    expect(localDayStart('2026-12-01')).toBe('2026-12-01T06:00:00.000Z'); // CST = UTC−6
    expect(localDayRange('2026-09-26', '2026-09-26')).toEqual({
      from: '2026-09-26T05:00:00.000Z', to: '2026-09-27T05:00:00.000Z', toExclusive: true });
  });

  it('passes full timestamps through and leaves missing bounds open', () => {
    expect(localDayRange('2026-09-26T10:00:00.000Z', null)).toEqual({ from: '2026-09-26T10:00:00.000Z', to: null, toExclusive: false });
    expect(localDayRange(undefined, '2026-09-26T23:00:00.000Z')).toEqual({ from: null, to: '2026-09-26T23:00:00.000Z', toExclusive: false });
  });
});

describe('an 8 pm sale counts on its local day everywhere', () => {
  it('reports, invoices, returns, audit, and inventory transactions', async () => {
    // 2026-09-26 20:00 in Chicago = 2026-09-27T01:00Z.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-27T01:00:00.000Z') });
    const { createUserWithToken } = await import('./test-helpers.js');
    const admin: TestUser = await createUserWithToken(app, 'admin');
    const as = (opts: InjectOptions) => app.inject({ ...opts, headers: admin.headers });
    const get = async (url: string) => {
      const r = await as({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      return r.json();
    };
    await as({ method: 'POST', url: '/api/drawer/open', payload: { openingFloatCents: 0 } });
    const item = (await as({ method: 'POST', url: '/api/inventory', payload: { name: 'Evening item', count: 5 } })).json();
    const s = (await as({ method: 'POST', url: '/api/pos/sale', payload: { clientRef: 'evening-sale-1', title: 'Evening sale',
      amountCents: 1000, method: 'card', inventoryItemId: item.id, stockQty: 1 } })).json();
    const line = (await get(`/api/invoices/${s.invoice.number}`)).lines[0];
    const ret = await as({ method: 'POST', url: '/api/returns', payload: { clientRef: 'evening-ret-1', invoiceId: s.invoice.id,
      reason: 'x', refundMethod: 'card', lines: [{ invoiceLineId: line.id, qty: 1 }] } });
    expect(ret.statusCode).toBe(201);
    expect(s.invoice.createdAt).toBe('2026-09-27T01:00:00.000Z');

    const day = 'from=2026-09-26&to=2026-09-26';
    const next = 'from=2026-09-27&to=2026-09-27';
    expect((await get(`/api/reports/sales?${day}`)).sales.invoiceCount).toBe(1);
    expect((await get(`/api/reports/sales?${next}`)).sales.invoiceCount).toBe(0);
    expect((await get(`/api/reports/summary?${day}`)).paymentCount).toBe(1);
    expect((await get(`/api/reports/summary?${next}`)).paymentCount).toBe(0);
    expect((await get(`/api/invoices?${day}`)).rows).toHaveLength(1);
    expect((await get(`/api/invoices?${next}`)).rows).toHaveLength(0);
    expect((await get(`/api/returns?${day}`)).rows).toHaveLength(1);
    expect((await get(`/api/returns?to=2026-09-25`)).rows).toHaveLength(0);
    expect((await get(`/api/audit?${day}&entity=invoice`)).rows.length).toBeGreaterThan(0);
    expect((await get(`/api/audit?${next}&entity=invoice`)).rows).toHaveLength(0);
    expect((await get(`/api/inventory/transactions?${day}&itemId=${item.id}`)).rows.length).toBeGreaterThan(0);
    expect((await get(`/api/inventory/transactions?${next}&itemId=${item.id}`)).rows).toHaveLength(0);
    const csv = await as({ method: 'GET', url: `/api/reports/payments.csv?${day}` });
    expect(csv.body.split('\n')).toHaveLength(3); // header + payment + refund
    vi.useRealTimers();
  });
});
