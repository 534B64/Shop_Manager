// UI foundation (ADR 0009): opt-in server paging on the heavy inventory reads
// and the SQL low-stock dashboard summary. Own throwaway SQLite file.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';
import { parsePage, parseSort, PagingError, likePattern } from './lib/paging.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let dbm: typeof import('./db/index.js');
let orm: typeof import('drizzle-orm');

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: admin.headers });
  return { status: res.statusCode, body: res.json() };
};

type Item = { id: number; name: string; count: number };
const ids: Record<string, number> = {};

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-paging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  dbm = await import('./db/index.js');
  orm = await import('drizzle-orm');
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');

  const cat = await app.inject({ method: 'POST', url: '/api/categories', headers: admin.headers, payload: { name: 'Blanks' } });
  const categoryId = cat.json().id as number;
  // name, count, Min, avgDailyUse, extras
  const spec: [string, number, number, number | null, Record<string, unknown>?][] = [
    ['Alpha vinyl', 0, 5, null, { color: 'Red' }],
    ['Bravo magnet', 2, 5, 1, { categoryId }],
    ['Charlie shirt', 10, 5, 2, { categoryId }],
    ['Delta 100% tape', 4, 5, 4, { vendor: 'Acme' }],
    ['Echo squeegee', 1, 5, null],
    ['Foxtrot ink', 30, 5, 0.5],
    ['Golf blank', 5, 5, 1],
  ];
  for (const [name, count, lowStockThreshold, rate, extra] of spec) {
    const res = await app.inject({ method: 'POST', url: '/api/inventory', headers: admin.headers,
      payload: { name, count, lowStockThreshold, ...extra } });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as Item).id;
    ids[name] = id;
    if (rate != null) await dbm.db.run(orm.sql`update inventory_items set avg_daily_use = ${rate} where id = ${id}`);
  }
  // An inactive item never appears.
  const res = await app.inject({ method: 'POST', url: '/api/inventory', headers: admin.headers, payload: { name: 'Zulu retired', count: 0, lowStockThreshold: 9 } });
  await dbm.db.run(orm.sql`update inventory_items set active = 0 where id = ${res.json().id}`);
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('paging helpers', () => {
  it('parsePage is opt-in and validates', () => {
    expect(parsePage({})).toBeNull();
    expect(parsePage({ limit: '10' })).toEqual({ limit: 10, offset: 0 });
    expect(parsePage({ offset: '20' })).toEqual({ limit: 25, offset: 20 });
    for (const bad of [{ limit: '0' }, { limit: '201' }, { limit: 'abc' }, { limit: '2.5' }, { offset: '-1' }]) {
      expect(() => parsePage(bad)).toThrow(PagingError);
    }
  });
  it('parseSort only accepts allowed keys; likePattern escapes wildcards', () => {
    expect(parseSort('count', ['name', 'count'] as const, 'name')).toBe('count');
    expect(parseSort('password', ['name', 'count'] as const, 'name')).toBe('name');
    expect(likePattern('100%_x')).toBe('%100\\%\\_x%');
  });
});

describe('GET /api/inventory paging', () => {
  it('without paging params still returns the bare array of active items', async () => {
    const { status, body } = await get('/api/inventory');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(7);
  });

  it('pages through every active item exactly once, name order', async () => {
    const names: string[] = [];
    for (let offset = 0; ; offset += 3) {
      const { body } = await get(`/api/inventory?limit=3&offset=${offset}`);
      expect(body.total).toBe(7);
      expect(body.limit).toBe(3);
      expect(body.offset).toBe(offset);
      names.push(...body.rows.map((r: Item) => r.name));
      if (body.rows.length < 3) break;
    }
    expect(names).toEqual(['Alpha vinyl', 'Bravo magnet', 'Charlie shirt', 'Delta 100% tape', 'Echo squeegee', 'Foxtrot ink', 'Golf blank']);
  });

  it('filters and sorts in SQL', async () => {
    const q = async (qs: string) => (await get(`/api/inventory?limit=50&${qs}`)).body;
    expect((await q('q=100%25')).rows.map((r: Item) => r.name)).toEqual(['Delta 100% tape']); // % is literal
    expect((await q('q=acme')).rows.map((r: Item) => r.name)).toEqual(['Delta 100% tape']);   // vendor
    expect((await q('color=red')).total).toBe(1);
    expect((await q('low=1')).total).toBe(5); // count <= Min
    expect((await q('stock=out')).rows.map((r: Item) => r.name)).toEqual(['Alpha vinyl']);
    expect((await q(`categoryId=${(await q('q=bravo')).rows[0].categoryId}`)).total).toBe(2);
    expect((await q('categoryId=none')).total).toBe(5);
    expect((await q('sort=count&dir=desc')).rows[0].name).toBe('Foxtrot ink');
    expect((await q('sort=nonsense')).rows[0].name).toBe('Alpha vinyl'); // unknown sort → name
  });

  it('rejects bad paging params with 400', async () => {
    for (const qs of ['limit=0', 'limit=500', 'limit=x', 'offset=-3']) {
      const { status, body } = await get(`/api/inventory?${qs}`);
      expect(status).toBe(400);
      expect(body.error).toBe('bad_paging');
    }
  });
});

describe('reorder / usage / dashboard', () => {
  it('paged reorder walks the same urgency order as the unpaged list', async () => {
    const all = (await get('/api/inventory/reorder')).body as Item[];
    expect(all.map((r) => r.name)).toEqual([
      // days until stockout: Bravo 2, Delta 1, Golf 5 → Delta, Bravo, Golf; then no rate, deepest below Min first
      'Delta 100% tape', 'Bravo magnet', 'Golf blank', 'Alpha vinyl', 'Echo squeegee',
    ]);
    const paged: Item[] = [];
    for (let offset = 0; offset < 10; offset += 2) {
      const { body } = await get(`/api/inventory/reorder?limit=2&offset=${offset}`);
      expect(body.total).toBe(5);
      paged.push(...body.rows);
    }
    expect(paged).toEqual(all);
  });

  it('paged usage: fastest movers first, no-rate items last', async () => {
    const { body } = await get('/api/inventory/usage?limit=50');
    expect(body.total).toBe(7);
    expect(body.rows.map((r: Item) => r.name)).toEqual([
      'Delta 100% tape', 'Charlie shirt', 'Bravo magnet', 'Golf blank', 'Foxtrot ink', 'Alpha vinyl', 'Echo squeegee',
    ]);
    expect(Array.isArray((await get('/api/inventory/usage')).body)).toBe(true);
  });

  it('valuation summed in SQL matches on-hand × average cost per item', async () => {
    await dbm.db.run(orm.sql`update inventory_items set avg_cost_cents = 150 where id in (${ids['Bravo magnet']}, ${ids['Charlie shirt']})`);
    await dbm.db.run(orm.sql`update inventory_items set avg_cost_cents = 99 where id = ${ids['Foxtrot ink']}`);
    const { body } = await get('/api/inventory/valuation');
    expect(body.totalCents).toBe(2 * 150 + 10 * 150 + 30 * 99);
    expect(body.pricedItems).toBe(3);
    expect(body.unpricedItems).toBe(4);
    expect(body.byCategory).toEqual([
      { name: 'Other', valueCents: 2970, items: 1 },
      { name: 'Blanks', valueCents: 1800, items: 2 },
    ]);
  });

  it('dashboard low stock comes from SQL: most urgent first, with the total count', async () => {
    const { body } = await get('/api/dashboard');
    expect(body.lowStockCount).toBe(5);
    expect(body.lowStock.map((r: Item) => r.name)).toEqual(['Delta 100% tape', 'Bravo magnet', 'Golf blank', 'Alpha vinyl', 'Echo squeegee']);
    expect(body.lowStock[0]).toEqual({ id: ids['Delta 100% tape'], name: 'Delta 100% tape', count: 4, threshold: 5 });
  });
});
