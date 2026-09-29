// Non-numeric ids in URLs are "not found" on every module, and /api/health tells
// the client which version/build this server is. Own throwaway SQLite file.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';
import { parseId, hasBadId } from './lib/ids.js';
import { loadBuildInfo } from './lib/build-info.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
const send = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string) =>
  app.inject({ method, url, headers: admin.headers, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-ids-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  admin = await createUserWithToken(app, 'admin');
});
afterAll(async () => {
  await app?.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
});

describe('parseId', () => {
  it('accepts whole numbers only', () => {
    expect(parseId('12')).toBe(12);
    expect(parseId('007')).toBe(7);
    for (const bad of ['abc', 'NaN', 'Infinity', '1.5', '-1', '1e3', '', ' 1', '0x10', '99999999999999999999', undefined, null, {}]) {
      expect(parseId(bad), String(bad)).toBeNull();
    }
  });
  it('hasBadId looks at id, colorId and sizeId only', () => {
    expect(hasBadId({ id: '5' })).toBe(false);
    expect(hasBadId({ id: 'x' })).toBe(true);
    expect(hasBadId({ id: '5', colorId: 'x' })).toBe(true);
    expect(hasBadId({ id: '5', sizeId: '2.5' })).toBe(true);
    expect(hasBadId({ number: 'INV-000001' })).toBe(false);
    expect(hasBadId(undefined)).toBe(false);
  });
});

describe('non-numeric ids → 404 {error: "Not found"} (never a database error)', () => {
  const cases: ['GET' | 'PUT' | 'POST' | 'DELETE', string][] = [
    ['GET', '/api/jobs/abc'], ['GET', '/api/jobs/NaN'], ['PUT', '/api/jobs/abc'], ['PUT', '/api/jobs/x/status'],
    ['POST', '/api/jobs/abc/convert'], ['GET', '/api/customers/abc'], ['PUT', '/api/customers/1.5'],
    ['GET', '/api/inventory/abc'], ['POST', '/api/inventory/abc/adjust'], ['GET', '/api/inventory/abc/history'],
    ['GET', '/api/cycle-counts/abc'], ['POST', '/api/cycle-counts/abc/post'], ['GET', '/api/materials/abc/colors'],
    ['DELETE', '/api/materials/1/colors/abc'], ['DELETE', '/api/categories/1/sizes/abc'], ['GET', '/api/drawer/abc'],
    ['GET', '/api/returns/abc'], ['POST', '/api/payments/abc/void'], ['POST', '/api/invoices/abc/void'],
    ['PUT', '/api/users/abc'], ['PUT', '/api/suppliers/abc'], ['PUT', '/api/locations/abc'],
  ];
  it.each(cases)('%s %s', async (method, url) => {
    const res = await send(method, url);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('numeric ids still reach the route (a missing job is its own 404, real ones work)', async () => {
    const list = await send('GET', '/api/jobs/board');
    expect(list.statusCode).toBe(200);
    const missing = await send('GET', '/api/jobs/999999');
    expect(missing.statusCode).toBe(404);
    expect((await send('GET', '/api/customers')).statusCode).toBe(200);
  });

  it('the invoice NUMBER route is untouched by the id check', async () => {
    const res = await send('GET', '/api/invoices/INV-000001');
    expect(res.json()).not.toEqual(undefined);
    expect(res.statusCode).not.toBe(500);
  });
});

describe('health: version and build', () => {
  it('reports the package version and a build (null when there is no dist)', async () => {
    const h = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(h.version).toBe(pkg.version);
    expect('build' in h).toBe(true);
  });

  it('shows the shop name and LAN addresses only to signed-in users; the port stays public', async () => {
    const anon = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect('port' in anon).toBe(true);
    expect('addresses' in anon).toBe(false);
    expect('hostname' in anon).toBe(false);
    const signed = (await app.inject({ method: 'GET', url: '/api/health', headers: admin.headers })).json();
    expect('addresses' in signed).toBe(true);
    expect('hostname' in signed).toBe(true);
  });

  it('loadBuildInfo reads dist/build-id.json and package.json; missing files are null/unknown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dperp-build-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
      expect(loadBuildInfo(path.join(dir, 'dist'), path.join(dir, 'package.json'))).toEqual({ version: '9.9.9', build: null });
      fs.mkdirSync(path.join(dir, 'dist'));
      fs.writeFileSync(path.join(dir, 'dist', 'build-id.json'), JSON.stringify({ build: 'abc123-xyz' }));
      expect(loadBuildInfo(path.join(dir, 'dist'), path.join(dir, 'package.json'))).toEqual({ version: '9.9.9', build: 'abc123-xyz' });
      expect(loadBuildInfo(path.join(dir, 'nope'), path.join(dir, 'nope.json'))).toEqual({ version: 'unknown', build: null });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
