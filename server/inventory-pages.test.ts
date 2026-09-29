// Reads the inventory pages need (wave 2): one item, id + match filters, the
// cross-item ledger (keyset, manager+), and cycle-count history / one session.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let manager: TestUser;
let cashier: TestUser;
const ids: Record<string, number> = {};

const req = async (who: TestUser, method: 'GET' | 'POST', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers: who.headers, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
};

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-invpages-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  manager = await createUserWithToken(app, 'manager');
  cashier = await createUserWithToken(app, 'cashier');
  for (const [name, count] of [['Red tape', 4], ['Tape red', 2], ['Blue vinyl', 9]] as const) {
    const r = await req(manager, 'POST', '/api/inventory', { name, count, lowStockThreshold: 1 });
    expect(r.status).toBe(201);
    ids[name] = r.body.id;
  }
  // Two receipts and one adjustment on Red tape → 4 ledger rows for it.
  await req(manager, 'POST', `/api/inventory/${ids['Red tape']}/adjust`, { delta: 3, reason: 'received', unitCostCents: 500 });
  await req(manager, 'POST', `/api/inventory/${ids['Red tape']}/adjust`, { delta: 2, reason: 'received' });
  const adj = await req(manager, 'POST', `/api/inventory/${ids['Red tape']}/adjust`, { delta: -1, reason: 'damaged', note: 'torn' });
  expect(adj.status).toBe(200);
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('GET /api/inventory/:id', () => {
  it('returns one item, or 404', async () => {
    const one = await req(cashier, 'GET', `/api/inventory/${ids['Red tape']}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ name: 'Red tape', count: 8 });
    expect((await req(cashier, 'GET', '/api/inventory/999999')).status).toBe(404);
  });
});

describe('item list filters: ids and match', () => {
  const names = async (qs: string) =>
    (await req(cashier, 'GET', `/api/inventory?limit=50&${qs}`)).body.rows.map((r: { name: string }) => r.name);
  it('ids limits to those items', async () => {
    expect(await names(`ids=${ids['Blue vinyl']},${ids['Tape red']}`)).toEqual(['Blue vinyl', 'Tape red']);
    expect(await names('ids=abc')).toEqual([]);
  });
  it('match switches contains / starts / ends / exact', async () => {
    expect(await names('q=red')).toEqual(['Red tape', 'Tape red']);
    expect(await names('q=red&match=starts')).toEqual(['Red tape']);
    expect(await names('q=red&match=ends')).toEqual(['Tape red']);
    expect(await names('q=red&match=exact')).toEqual([]);
    expect(await names('q=blue%20vinyl&match=exact')).toEqual(['Blue vinyl']);
  });
});

describe('GET /api/inventory/transactions', () => {
  it('is manager-only', async () => {
    expect((await req(cashier, 'GET', '/api/inventory/transactions')).status).toBe(403);
  });
  it('lists newest first with item names, filters by type and item, and pages by id', async () => {
    const all = await req(manager, 'GET', '/api/inventory/transactions');
    expect(all.status).toBe(200);
    expect(all.body.rows[0]).toMatchObject({ itemName: 'Red tape', txnType: 'adjustment', delta: -1, reason: 'damaged', locationName: 'Shop' });
    const receipts = await req(manager, 'GET', '/api/inventory/transactions?type=receipt');
    expect(receipts.body.rows.map((r: { delta: number }) => r.delta)).toEqual([2, 3]);
    const red = await req(manager, 'GET', `/api/inventory/transactions?itemId=${ids['Red tape']}&limit=2`);
    expect(red.body.rows).toHaveLength(2);
    expect(red.body.nextBefore).toBe(red.body.rows[1].id);
    const rest = await req(manager, 'GET', `/api/inventory/transactions?itemId=${ids['Red tape']}&limit=2&before=${red.body.nextBefore}`);
    expect(rest.body.rows.map((r: { txnType: string }) => r.txnType)).toEqual(['receipt', 'opening']);
    // The shop's local day (date filters are local days) — a UTC date broke this after ~7 pm Central.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect((await req(manager, 'GET', `/api/inventory/transactions?from=${today}&to=${today}`)).body.rows.length).toBe(all.body.rows.length);
    expect((await req(manager, 'GET', '/api/inventory/transactions?to=2000-01-01')).body.rows).toEqual([]);
  });
});

describe('cycle-count history and one session', () => {
  it('keeps lines hidden while counting, shows them once submitted, and lists history newest first', async () => {
    const cc = (await req(manager, 'POST', '/api/cycle-counts', { scheduledFor: '2026-10-01' })).body as { id: number };
    const counting = await req(cashier, 'GET', `/api/cycle-counts/${cc.id}`);
    expect(counting.status).toBe(200);
    expect(counting.body).toMatchObject({ status: 'counting', lines: [] });
    const sub = await req(cashier, 'POST', `/api/cycle-counts/${cc.id}/submit`,
      { counts: [{ itemId: ids['Blue vinyl'], counted: 9 }, { itemId: ids['Tape red'], counted: 1, reasonCode: 'correction' }] });
    expect(sub.status).toBe(200);
    const submitted = await req(cashier, 'GET', `/api/cycle-counts/${cc.id}`);
    expect(submitted.body.status).toBe('submitted');
    expect(submitted.body.lines).toHaveLength(2);
    expect(submitted.body.lines[1]).toMatchObject({ name: 'Tape red', systemCount: 2, countedQty: 1, reasonCode: 'correction' });
    await req(manager, 'POST', `/api/cycle-counts/${cc.id}/post`, {});
    const hist = await req(cashier, 'GET', '/api/cycle-counts?limit=10');
    expect(hist.body.total).toBe(2); // the posted one + the next it queued
    expect(hist.body.rows[1]).toMatchObject({ id: cc.id, status: 'posted' });
    expect((await req(cashier, 'GET', '/api/cycle-counts?limit=0')).status).toBe(400);
    expect((await req(cashier, 'GET', '/api/cycle-counts/424242')).status).toBe(404);
  });
});
