// Optional item names (2026-09-29): a name is generated from category/color/size
// unless the owner typed one.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let cashier: TestUser;
let cat651 = 0;
let catShirt = 0;

const call = async (who: TestUser, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
  const res = await app.inject({ method, url, headers: who.headers, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
};

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-itemnames-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  cashier = await createUserWithToken(app, 'cashier');
  cat651 = (await call(admin, 'POST', '/api/categories', { name: '651' })).body.id;
  catShirt = (await call(admin, 'POST', '/api/categories', { name: 'T-shirt blank' })).body.id;
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('item names', () => {
  it('creates without a name and stores the generated one', async () => {
    const r = await call(cashier, 'POST', '/api/inventory', { categoryId: cat651, color: 'Red', sizeText: '15' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Red 651 15″', nameIsCustom: false });
    const blank = await call(cashier, 'POST', '/api/inventory', { name: '  ', categoryId: catShirt, sizeText: 'L' });
    expect(blank.body).toMatchObject({ name: 'T-shirt blank L', nameIsCustom: false });
  });

  it('keeps a custom name and marks it custom', async () => {
    const r = await call(cashier, 'POST', '/api/inventory', { name: ' Shop favorite ', categoryId: cat651, color: 'Blue' });
    expect(r.body).toMatchObject({ name: 'Shop favorite', nameIsCustom: true });
    const e = await call(cashier, 'PUT', `/api/inventory/${r.body.id}`, { color: 'Green' });
    expect(e.body).toMatchObject({ name: 'Shop favorite', color: 'Green', nameIsCustom: true });
  });

  it('refuses an item with neither a name nor anything to build one from', async () => {
    const r = await call(cashier, 'POST', '/api/inventory', { lowStockThreshold: 2 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/category, color or size/);
    const unitOnly = await call(cashier, 'POST', '/api/inventory', { countUnit: 'roll' });
    expect(unitOnly.status).toBe(400);
  });

  it('regenerates the name when color, size or category change', async () => {
    const id = (await call(cashier, 'POST', '/api/inventory', { categoryId: cat651, color: 'Red', sizeText: '15' })).body.id;
    expect((await call(cashier, 'PUT', `/api/inventory/${id}`, { color: 'Black' })).body.name).toBe('Black 651 15″');
    expect((await call(cashier, 'PUT', `/api/inventory/${id}`, { sizeText: '24in' })).body.name).toBe('Black 651 24″');
    expect((await call(cashier, 'PUT', `/api/inventory/${id}`, { categoryId: catShirt })).body.name).toBe('Black T-shirt blank 24″');
    const cleared = await call(cashier, 'PUT', `/api/inventory/${id}`, { color: null, sizeText: null, categoryId: null });
    expect(cleared.status).toBe(400);
  });

  it('typing a name makes it custom; clearing it goes back to generated', async () => {
    const id = (await call(cashier, 'POST', '/api/inventory', { categoryId: cat651, color: 'Gold' })).body.id;
    const typed = await call(cashier, 'PUT', `/api/inventory/${id}`, { name: 'Gold leaf' });
    expect(typed.body).toMatchObject({ name: 'Gold leaf', nameIsCustom: true });
    const back = await call(cashier, 'PUT', `/api/inventory/${id}`, { name: '' });
    expect(back.body).toMatchObject({ name: 'Gold 651', nameIsCustom: false });
  });

  it('renaming a category refreshes generated names but not custom ones', async () => {
    const c = (await call(admin, 'POST', '/api/categories', { name: 'Cast' })).body.id;
    const gen = (await call(cashier, 'POST', '/api/inventory', { categoryId: c, color: 'Red' })).body.id;
    const cus = (await call(cashier, 'POST', '/api/inventory', { name: 'My cast', categoryId: c, color: 'Red' })).body.id;
    await call(admin, 'PUT', `/api/categories/${c}`, { name: 'Cast 2mil' });
    expect((await call(cashier, 'GET', `/api/inventory/${gen}`)).body.name).toBe('Red Cast 2mil');
    expect((await call(cashier, 'GET', `/api/inventory/${cus}`)).body.name).toBe('My cast');
  });

  it('search finds items by category and size even when the name is custom', async () => {
    const c = (await call(admin, 'POST', '/api/categories', { name: 'Perforated' })).body.id;
    const id = (await call(cashier, 'POST', '/api/inventory', { name: 'Window stuff', categoryId: c, sizeText: '54' })).body.id;
    const ids = async (q: string) => (await call(cashier, 'GET', `/api/inventory?limit=50&q=${q}`)).body.rows.map((r: { id: number }) => r.id);
    expect(await ids('perfor')).toContain(id);
    expect(await ids('54')).toContain(id);
    expect(await ids('nomatchzzz')).not.toContain(id);
    // Generated names are searchable by their parts too.
    const gen = (await call(cashier, 'POST', '/api/inventory', { categoryId: c, color: 'Silver', sizeText: '30' })).body;
    expect(gen.name).toBe('Silver Perforated 30″');
    expect(await ids('silver')).toContain(gen.id);
  });

  it('roll SKUs use the material name', async () => {
    const mat = (await call(admin, 'POST', '/api/materials', { name: 'Calendered vinyl (651-type)', unit: 'sqft', costPerUnitCents: 100, priceMode: 'per_sqft', rateCents: 600, usesRoll: true })).body;
    expect(mat.id).toBeTruthy();
    await call(admin, 'POST', `/api/materials/${mat.id}/colors`, { name: 'Red' });
    const sku = await call(admin, 'POST', '/api/roll-skus', { materialId: mat.id, color: 'Red', nominalWidthIn: 24 });
    expect(sku.status).toBe(201);
    expect(sku.body).toMatchObject({ name: 'Red Calendered vinyl (651-type) 24″', nameIsCustom: false });
  });
});
