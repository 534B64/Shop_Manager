// Admin pages (wave 2): opt-in paging on /api/customers, the email rule on
// customer edits, and the admin-only approvals list. Own throwaway SQLite file.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { TestUser } from './test-helpers.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let manager: TestUser;
let cashier: TestUser;

const inject = (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { authorization: `Bearer ${admin.token}`, ...(opts.headers ?? {}) } });
const getJson = async (url: string, headers?: Record<string, string>) => {
  const res = await inject({ method: 'GET', url, headers });
  return { status: res.statusCode, body: res.json() };
};
const ids: Record<string, number> = {};

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
  manager = await createUserWithToken(app, 'manager', { name: 'Mgr Amy' });
  cashier = await createUserWithToken(app, 'cashier', { name: 'Cash Sam' });
  const spec: [string, string, string?][] = [
    ['Acme Signs', 'acme@x.example', '(555) 123-4567'],
    ['Bravo Bakery', 'bravo@x.example'],
    ['charlie 100% Co', 'charlie@x.example', '555-987-0000'],
    ['Delta Dental', 'delta@x.example'],
    ['Walk-in', ''],
  ];
  for (const [name, email, phone] of spec) {
    const res = await inject({ method: 'POST', url: '/api/customers',
      payload: { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) } });
    expect(res.statusCode).toBe(201);
    ids[name] = res.json().id;
  }
  // Delta is archived (by a manager acting on their own authority → an approvals row).
  expect((await inject({ method: 'DELETE', url: `/api/customers/${ids['Delta Dental']}`, payload: {}, headers: manager.headers })).statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

describe('GET /api/customers paging', () => {
  it('stays a bare array without limit/offset', async () => {
    const { body } = await getJson('/api/customers');
    expect(Array.isArray(body)).toBe(true);
  });

  it('pages with total, sorted by name, hiding archived by default', async () => {
    const p1 = await getJson('/api/customers?limit=2&offset=0&sort=name');
    expect(p1.status).toBe(200);
    expect(p1.body.total).toBe(4);
    expect(p1.body.limit).toBe(2);
    expect(p1.body.rows.map((r: { name: string }) => r.name)).toEqual(['Acme Signs', 'Bravo Bakery']);
    const p2 = await getJson('/api/customers?limit=2&offset=2&sort=name');
    expect(p2.body.rows.map((r: { name: string }) => r.name)).toEqual(['charlie 100% Co', 'Walk-in']);
    expect(p2.body.rows[0]).toHaveProperty('lastJobAt');
  });

  it('includeArchived=1 adds archived rows', async () => {
    const { body } = await getJson('/api/customers?limit=50&includeArchived=1&sort=name');
    expect(body.total).toBe(5);
    expect(body.rows.find((r: { name: string }) => r.name === 'Delta Dental').archivedAt).toBeTruthy();
  });

  it('q matches name, email, or phone digits; % is literal', async () => {
    const names = async (q: string) =>
      (await getJson(`/api/customers?limit=50&q=${encodeURIComponent(q)}`)).body.rows.map((r: { name: string }) => r.name);
    expect(await names('bakery')).toEqual(['Bravo Bakery']);
    expect(await names('acme@')).toEqual(['Acme Signs']);
    expect(await names('5551234')).toEqual(['Acme Signs']);
    expect(await names('987-0000')).toEqual(['charlie 100% Co']);
    expect(await names('100%')).toEqual(['charlie 100% Co']);
    expect(await names('0%')).toEqual(['charlie 100% Co']);
    expect(await names('delta')).toEqual([]);
  });

  it('rejects a bad page size', async () => {
    const { status, body } = await getJson('/api/customers?limit=500');
    expect(status).toBe(400);
    expect(body.error).toBe('bad_paging');
  });
});

describe('PUT /api/customers/:id email rule', () => {
  it('refuses clearing or breaking the email; Walk-in is exempt; phone-only edits pass', async () => {
    const put = (id: number, payload: object) => inject({ method: 'PUT', url: `/api/customers/${id}`, payload });
    expect((await put(ids['Acme Signs'], { email: '' })).statusCode).toBe(400);
    expect((await put(ids['Acme Signs'], { email: 'nope' })).statusCode).toBe(400);
    expect((await put(ids['Acme Signs'], { email: 'new@acme.example' })).statusCode).toBe(200);
    expect((await put(ids['Walk-in'], { email: '' })).statusCode).toBe(200);
    expect((await put(ids['Walk-in'], { notes: 'counter' })).statusCode).toBe(200);
    // Renaming the Walk-in record to a real name needs an email.
    expect((await put(ids['Walk-in'], { name: 'Real Person' })).statusCode).toBe(400);
  });

  it('a legacy customer without an email can still have name / phone / notes edited', async () => {
    const { db } = await import('./db/index.js');
    const { customers } = await import('./db/schema/index.js');
    const [legacy] = await db.insert(customers).values({ name: 'Old Timer' }).returning();
    const put = (payload: object) => inject({ method: 'PUT', url: `/api/customers/${legacy.id}`, payload });
    expect((await put({ phone: '555-123-4567' })).statusCode).toBe(200);
    expect((await put({ notes: 'pays cash' })).statusCode).toBe(200);
    expect((await put({ name: 'Old Timer Sr' })).statusCode).toBe(200);
    expect((await put({ email: '' })).statusCode).toBe(200); // nothing to clear
    expect((await put({ email: 'bad' })).statusCode).toBe(400);
    const ok = await put({ email: 'old@timer.example' });
    expect(ok.json()).toMatchObject({ name: 'Old Timer Sr', phone: '555-123-4567', notes: 'pays cash', email: 'old@timer.example' });
    expect((await put({ email: '' })).statusCode).toBe(400); // once set, it can't be removed
  });
});

describe('GET /api/approvals', () => {
  it('is admin-only', async () => {
    expect((await getJson('/api/approvals', manager.headers)).status).toBe(403);
    expect((await getJson('/api/approvals', cashier.headers)).status).toBe(403);
  });

  it('lists who approved what with names, newest first, with a keyset cursor and filters', async () => {
    // A cashier's credit adjustment approved by the manager's PIN.
    const res = await inject({ method: 'POST', url: `/api/customers/${ids['Acme Signs']}/credit`, headers: cashier.headers,
      payload: { deltaCents: 500, note: 'goodwill', approval: { name: manager.name, pin: manager.pin } } });
    expect(res.statusCode).toBe(200);

    const all = await getJson('/api/approvals');
    expect(all.status).toBe(200);
    const [newest, older] = all.body.rows;
    expect(newest).toMatchObject({ action: 'customer.credit_adjust', entity: 'customer', entityId: String(ids['Acme Signs']),
      requestedByName: 'Cash Sam', approvedByName: 'Mgr Amy', reason: 'goodwill' });
    expect(older).toMatchObject({ action: 'customer.delete', requestedByName: 'Mgr Amy', approvedByName: 'Mgr Amy' });
    expect(all.body.nextBefore).toBeNull();

    const p1 = await getJson('/api/approvals?limit=1');
    expect(p1.body.rows).toHaveLength(1);
    expect(p1.body.nextBefore).toBe(newest.id);
    const p2 = await getJson(`/api/approvals?limit=1&before=${p1.body.nextBefore}`);
    expect(p2.body.rows[0].id).toBe(older.id);

    expect((await getJson('/api/approvals?action=customer.delete')).body.rows).toHaveLength(1);
    expect((await getJson(`/api/approvals?userId=${cashier.id}`)).body.rows.map((r: { id: number }) => r.id)).toEqual([newest.id]);
    expect((await getJson('/api/approvals?from=2999-01-01')).body.rows).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await getJson(`/api/approvals?to=${today}`)).body.rows).toHaveLength(2);
  });
});
