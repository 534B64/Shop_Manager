// Jobs pages (wave 2): the paged job list, the Orders board lanes, the
// dashboard's due-soon list and top balances, and the invoice state on a job.
// Own throwaway SQLite file.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;

const inject = (opts: InjectOptions) => app.inject({ ...opts, headers: { ...admin.headers, ...(opts.headers ?? {}) } });
const get = async (url: string) => { const r = await inject({ method: 'GET', url }); return { status: r.statusCode, body: r.json() }; };
const uniq = () => Math.random().toString(36).slice(2, 8);

type Row = { id: number; title: string; status: string; dueDate: string | null };
const TODAY = '2030-03-10';
const ids: Record<string, number> = {};

async function makeJob(title: string, over: Record<string, unknown> = {}) {
  const res = await inject({ method: 'POST', url: '/api/jobs', payload: {
    clientRef: crypto.randomUUID(), type: 'decal', title, status: 'acknowledged', finalPriceCents: 1000, ...over,
  } });
  expect(res.statusCode).toBe(201);
  ids[title] = res.json().id;
  return res.json() as { id: number };
}
const move = (id: number, status: string) =>
  inject({ method: 'PUT', url: `/api/jobs/${id}/status`, payload: { status, override: true } });

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-jobs-${Date.now()}-${uniq()}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');

  await makeJob('Overdue banner', { dueDate: '2030-03-08', finalPriceCents: 5000 });
  await makeJob('Today magnet', { dueDate: TODAY, finalPriceCents: 2000 });
  await makeJob('Soon decal', { dueDate: '2030-03-15' });
  await makeJob('Later sign', { dueDate: '2030-04-30' });
  await makeJob('No date shirt');
  await makeJob('Proof quote', { status: 'quote', useProofFlow: true, dueDate: '2030-03-09' });
  const done = await makeJob('Finished 100% vinyl', { dueDate: '2030-03-01' });
  await move(done.id, 'in_progress'); await move(done.id, 'done');
  const gone = await makeJob('Picked up tote');
  await move(gone.id, 'in_progress'); await move(gone.id, 'done'); await move(gone.id, 'picked_up');
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('GET /api/jobs', () => {
  it('keeps the bare array for ?limit= and pages with offset', async () => {
    const legacy = await get('/api/jobs?limit=3');
    expect(Array.isArray(legacy.body)).toBe(true);
    expect(legacy.body).toHaveLength(3);
    const p = await get('/api/jobs?limit=3&offset=3');
    expect(p.body).toMatchObject({ total: 8, limit: 3, offset: 3 });
    expect(p.body.rows).toHaveLength(3);
    const first = (await get('/api/jobs?limit=3&offset=0')).body.rows as Row[];
    expect(first.map((r) => r.id)).not.toContain((p.body.rows as Row[])[0].id);
  });
  it('filters by search and a status list, and rejects bad paging', async () => {
    const q = await get(`/api/jobs?offset=0&q=${encodeURIComponent('100%')}`);
    expect((q.body.rows as Row[]).map((r) => r.title)).toEqual(['Finished 100% vinyl']);
    const s = await get('/api/jobs?offset=0&status=done,picked_up');
    expect(s.body.total).toBe(2);
    expect((await get('/api/jobs?offset=0&limit=500')).status).toBe(400);
  });
});

describe('GET /api/jobs/board', () => {
  it('returns every lane with counts, soonest due first, capped by limit', async () => {
    const { body } = await get('/api/jobs/board?limit=2');
    const lanes = Object.fromEntries((body.lanes as { status: string; rows: Row[]; total: number }[]).map((l) => [l.status, l]));
    expect(Object.keys(lanes)).toEqual(['quote', 'approved', 'design', 'acknowledged', 'in_progress', 'done', 'picked_up']);
    expect(lanes.acknowledged.total).toBe(5);
    expect(lanes.acknowledged.rows.map((r) => r.title)).toEqual(['Overdue banner', 'Today magnet']);
    expect(lanes.quote.total).toBe(1);
    expect(lanes.picked_up.rows[0].title).toBe('Picked up tote');
  });
  it('searches across lanes', async () => {
    const { body } = await get('/api/jobs/board?q=magnet');
    const totals = (body.lanes as { status: string; total: number }[]).filter((l) => l.total > 0);
    expect(totals).toEqual([{ status: 'acknowledged', total: 1, rows: expect.any(Array) }]);
  });
});

describe('GET /api/jobs/due-soon', () => {
  it('lists open jobs due within the window (overdue included), soonest first', async () => {
    const { body } = await get(`/api/jobs/due-soon?today=${TODAY}&days=7&limit=3`);
    expect(body).toMatchObject({ today: TODAY, until: '2030-03-17', total: 4, overdue: 2 });
    expect((body.rows as Row[]).map((r) => r.title)).toEqual(['Overdue banner', 'Proof quote', 'Today magnet']);
  });
  it('skips done and picked-up jobs', async () => {
    const { body } = await get(`/api/jobs/due-soon?today=${TODAY}&days=60&limit=50`);
    const titles = (body.rows as Row[]).map((r) => r.title);
    expect(titles).toContain('Later sign');
    expect(titles).not.toContain('Finished 100% vinyl');
    expect(titles).not.toContain('No date shirt');
  });
});

describe('job detail + balances', () => {
  it('reports the live invoice and balance on GET /api/jobs/:id', async () => {
    const before = (await get(`/api/jobs/${ids['Soon decal']}`)).body;
    expect(before).toMatchObject({ invoice: null, owedCents: 1000 });
    const pay = await inject({ method: 'POST', url: '/api/payments',
      payload: { clientRef: crypto.randomUUID(), jobId: ids['Soon decal'], amountCents: 1000, method: 'card' } });
    expect(pay.statusCode).toBe(201);
    const after = (await get(`/api/jobs/${ids['Soon decal']}`)).body;
    expect(after.owedCents).toBe(0);
    expect(after.invoice.number).toMatch(/^\d{6}$/);
  });
  it('pages /api/balances largest first with the count and total owed', async () => {
    const all = (await get('/api/balances')).body as { owedCents: number }[];
    const { body } = await get('/api/balances?limit=2');
    expect(body.total).toBe(all.length);
    expect(body.totalOwedCents).toBe(all.reduce((s, b) => s + b.owedCents, 0));
    expect(body.rows.map((r: { title: string }) => r.title)).toEqual(['Overdue banner', 'Today magnet']);
    expect(body.rows[0].owedCents).toBe(5000);
  });
});
