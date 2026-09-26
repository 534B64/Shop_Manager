// Inventory list group-by + the restored sorts (size, color, low first) —
// the old Inventory page's Group by / Sort controls, now in SQL.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;

const req = async (method: 'GET' | 'POST', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers: admin.headers, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
};
type Row = { name: string; groupKey: string; groupLabel: string };
const list = async (qs: string) => (await req('GET', `/api/inventory?limit=50&${qs}`)).body as
  { rows: Row[]; groups?: { key: string; label: string; count: number; low: number }[] };
const names = async (qs: string) => (await list(qs)).rows.map((r) => r.name);

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-invgroup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  const material = async (name: string, colors: string[]) => {
    const id = (await req('POST', '/api/materials', { name, unit: 'sqft', costPerUnitCents: 100, usesRoll: true })).body.id as number;
    for (const c of colors) await req('POST', `/api/materials/${id}/colors`, { name: c });
    return id;
  };
  const zeta = await material('Zeta vinyl', ['Red']);
  const alpha = await material('Alpha vinyl', ['Blue', 'red']);
  for (const [materialId, color, nominalWidthIn, count] of [[zeta, 'Red', 24, 5], [alpha, 'Blue', 48, 0], [alpha, 'red', 12, 3]] as const) {
    const r = await req('POST', '/api/roll-skus', { materialId, color, nominalWidthIn, count, lowStockThreshold: 1 });
    expect(r.status).toBe(201);
  }
  const cat = (await req('POST', '/api/categories', { name: 'Blanks' })).body.id;
  for (const body of [
    { name: 'Tee M', count: 1, lowStockThreshold: 2, categoryId: cat, sizeText: 'M', countUnit: 'each' },
    { name: 'Squeegee', count: 9, lowStockThreshold: 2, countUnit: 'each' },
  ]) expect((await req('POST', '/api/inventory', body)).status).toBe(201);
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('group=', () => {
  it('material: by material name, then the sort, with "Other" last', async () => {
    const r = await list('group=material');
    expect(r.rows.map((x) => [x.groupLabel, x.name])).toEqual([
      ['Alpha vinyl', 'Alpha vinyl · Blue · 48in'], ['Alpha vinyl', 'Alpha vinyl · red · 12in'],
      ['Zeta vinyl', 'Zeta vinyl · Red · 24in'],
      ['Other / Consumables', 'Squeegee'], ['Other / Consumables', 'Tee M'],
    ]);
    expect(r.rows[3].groupKey).toBe('other');
    const alpha = r.groups!.find((g) => g.label === 'Alpha vinyl')!;
    expect(alpha).toMatchObject({ count: 2, low: 1 });
  });
  it('color groups case-insensitively; size puts widths numerically before free-text sizes', async () => {
    expect((await list('group=color')).rows.map((x) => x.groupKey)).toEqual(['color:blue', 'color:red', 'color:red', 'other', 'other']);
    expect((await list('group=size')).rows.map((x) => x.groupLabel)).toEqual(['12″', '24″', '48″', 'M', 'Other / Consumables']);
  });
  it('unit and category', async () => {
    expect((await names('group=unit')).slice(0, 2)).toEqual(['Squeegee', 'Tee M']);
    expect((await list('group=category')).rows[0]).toMatchObject({ name: 'Tee M', groupLabel: 'Blanks' });
  });
  it('the chosen sort applies inside each group; no group = no group fields', async () => {
    expect(await names('group=material&sort=name&dir=desc')).toEqual([
      'Alpha vinyl · red · 12in', 'Alpha vinyl · Blue · 48in', 'Zeta vinyl · Red · 24in', 'Tee M', 'Squeegee']);
    const plain = await list('group=bogus');
    expect(plain.groups).toBeUndefined();
    expect(plain.rows[0]).not.toHaveProperty('groupKey');
  });
});

describe('restored sorts', () => {
  it('size: narrowest first, items without a width last', async () => {
    expect((await names('sort=size')).slice(0, 3)).toEqual(['Alpha vinyl · red · 12in', 'Zeta vinyl · Red · 24in', 'Alpha vinyl · Blue · 48in']);
  });
  it('color: A–Z, no color last', async () => {
    expect(await names('sort=color')).toEqual(['Alpha vinyl · Blue · 48in', 'Alpha vinyl · red · 12in', 'Zeta vinyl · Red · 24in', 'Squeegee', 'Tee M']);
  });
  it('low: at/below Min first, then by name', async () => {
    expect(await names('sort=low')).toEqual(['Alpha vinyl · Blue · 48in', 'Tee M', 'Alpha vinyl · red · 12in', 'Squeegee', 'Zeta vinyl · Red · 24in']);
  });
});
