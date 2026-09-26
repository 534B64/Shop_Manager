// Opt-in paging (+ q search) on /api/payments and /api/balances for the
// Payments page (ADR 0009 contract). The unpaged shapes are unchanged.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
const ref = () => crypto.randomUUID();

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: admin.headers });
  return { status: res.statusCode, body: res.json() };
};
const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: admin.headers, payload });

async function job(title: string, finalPriceCents: number) {
  const res = await post('/api/jobs', { clientRef: ref(), type: 'decal', title, status: 'acknowledged', finalPriceCents });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; totalCents: number | null };
}

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-paypage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  // Every payment needs an open drawer (D12).
  await app.inject({ method: 'POST', url: '/api/drawer/open', headers: admin.headers, payload: { openingFloatCents: 0 } });
  const a = await job('Alpha banner', 10000);
  const b = await job('Bravo decal', 5000);
  const c = await job('Charlie 100% sign', 2000);
  await job('Delta paid', 1000).then(async (d) =>
    expect((await post('/api/payments', { clientRef: ref(), jobId: d.id, amountCents: d.totalCents ?? 1000, method: 'card' })).statusCode).toBe(201));
  for (const [j, amt] of [[a, 1000], [b, 500], [c, 100]] as const) {
    expect((await post('/api/payments', { clientRef: ref(), jobId: j.id, amountCents: amt, method: 'check' })).statusCode).toBe(201);
  }
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ }
  }
});

describe('GET /api/payments paging', () => {
  it('keeps the bare array when unpaged', async () => {
    const r = await get('/api/payments');
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(4);
  });

  it('pages newest first with a total, and searches job title / customer', async () => {
    const p1 = await get('/api/payments?limit=2&offset=0');
    expect(p1.body).toMatchObject({ total: 4, limit: 2, offset: 0 });
    expect(p1.body.rows).toHaveLength(2);
    const p2 = await get('/api/payments?limit=2&offset=2');
    const ids = [...p1.body.rows, ...p2.body.rows].map((r: { id: number }) => r.id);
    expect(ids).toEqual([...ids].sort((x, y) => y - x));
    const hit = await get('/api/payments?limit=10&q=bravo');
    expect(hit.body.total).toBe(1);
    expect(hit.body.rows[0]).toMatchObject({ jobTitle: 'Bravo decal', amountCents: 500 });
    // % is literal, not a wildcard.
    expect((await get('/api/payments?limit=10&q=100%25')).body.total).toBe(1);
  });

  it('refuses a bad page size', async () => {
    const r = await get('/api/payments?limit=0');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_paging');
  });
});

describe('GET /api/balances paging', () => {
  it('keeps the bare array when unpaged (owed only)', async () => {
    const r = await get('/api/balances');
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.map((b: { title: string }) => b.title).sort()).toEqual(['Alpha banner', 'Bravo decal', 'Charlie 100% sign']);
  });

  it('pages largest balance first with the total owed, and searches', async () => {
    const all = await get('/api/balances');
    const sum = all.body.reduce((s: number, b: { owedCents: number }) => s + b.owedCents, 0);
    const p = await get('/api/balances?limit=2');
    expect(p.body).toMatchObject({ total: 3, limit: 2, offset: 0, totalOwedCents: sum });
    const owed = p.body.rows.map((b: { owedCents: number }) => b.owedCents);
    expect(owed[0]).toBeGreaterThanOrEqual(owed[1]);
    expect(p.body.rows[0].title).toBe('Alpha banner');
    const last = await get('/api/balances?limit=2&offset=2');
    expect(last.body.rows.map((b: { title: string }) => b.title)).toEqual(['Charlie 100% sign']);
    const q = await get('/api/balances?limit=5&q=brav');
    expect(q.body.rows).toHaveLength(1);
    expect(q.body.rows[0]).toMatchObject({ title: 'Bravo decal', paidCents: 500 });
    expect(q.body.rows[0].owedCents).toBe(q.body.rows[0].finalPriceCents - 500);
  });
});

describe('GET /api/reports/summary (Quick Order "today")', () => {
  it('filters by date or timestamp in SQL and counts payments apart from refunds', async () => {
    const all = await get('/api/reports/summary');
    expect(all.body).toMatchObject({ count: 4, paymentCount: 4, paymentsCents: 1000 + 500 + 100 + all.body.byMethod.card });
    const since = new Date(Date.now() - 60_000).toISOString();
    expect((await get(`/api/reports/summary?from=${since}`)).body.paymentCount).toBe(4);
    expect((await get('/api/reports/summary?to=2000-01-01')).body).toMatchObject({ count: 0, paymentCount: 0, paymentsCents: 0 });
  });
});
