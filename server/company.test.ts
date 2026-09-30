// Company name (2026-09-29): default rules, admin-only edits, public sign-in exposure, health `app`.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TestUser } from './test-helpers.js';
import { resolveDefaultCompanyName } from './modules/settings/company.js';

let app: FastifyInstance;
let dbFile: string;
let admin: TestUser;
let cashier: TestUser;

const call = async (who: TestUser | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
  const res = await app.inject({ method, url, ...(who ? { headers: who.headers } : {}), ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
};

beforeAll(async () => {
  dbFile = path.join(os.tmpdir(), `dperp-company-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  process.env.DB_PATH = dbFile;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  await app.ready();
  const { createUserWithToken } = await import('./test-helpers.js');
  // First-run: no admin yet, so the status is public and needsSetup.
  admin = await createUserWithToken(app, 'admin');
  cashier = await createUserWithToken(app, 'cashier');
});

afterAll(async () => {
  await app.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + s); } catch { /* ignore */ } }
});

describe('default company name', () => {
  it('Setup name wins, else the original shop only when data exists, else blank', () => {
    expect(resolveDefaultCompanyName({ shopEnvName: ' Acme  Signs ', hasData: true })).toBe('Acme Signs');
    expect(resolveDefaultCompanyName({ shopEnvName: 'Acme', hasData: false })).toBe('Acme');
    expect(resolveDefaultCompanyName({ shopEnvName: null, hasData: true })).toBe('Decals Plus');
    expect(resolveDefaultCompanyName({ shopEnvName: '  ', hasData: true })).toBe('Decals Plus');
    expect(resolveDefaultCompanyName({ shopEnvName: null, hasData: false })).toBe('');
  });

  it('is written once at start and does not change as data arrives', async () => {
    const { db } = await import('./db/index.js');
    const { settings } = await import('./db/schema/index.js');
    const { ensureCompanyName, getCompanyName } = await import('./modules/settings/company.js');
    await db.delete(settings).where(eq(settings.key, 'companyName'));
    expect(await ensureCompanyName(null)).toBe(''); // empty database, no shop.env
    await call(cashier, 'POST', '/api/customers', { name: 'Someone', email: 'someone@example.com' });
    expect(await ensureCompanyName(null)).toBe('');
    expect(await getCompanyName()).toBe('');
    // An existing install with data but no setting adopts the original shop's name.
    await db.delete(settings).where(eq(settings.key, 'companyName'));
    expect(await ensureCompanyName(null)).toBe('Decals Plus');
    // Once set, Setup's name does not overwrite it.
    expect(await ensureCompanyName('Other Co')).toBe('Decals Plus');
    await db.delete(settings).where(eq(settings.key, 'companyName'));
    expect(await ensureCompanyName('Other Co')).toBe('Other Co');
  });
});

describe('company name API', () => {
  it('an admin can change it; it is trimmed, audited and readable by any signed-in user', async () => {
    const put = await call(admin, 'PUT', '/api/settings/company', { companyName: '  Acme   Signs ' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ companyName: 'Acme Signs' });
    expect((await call(cashier, 'GET', '/api/settings/company')).body).toEqual({ companyName: 'Acme Signs' });
    const audit = await call(admin, 'GET', '/api/audit?entity=setting');
    expect(JSON.stringify(audit.body)).toContain('companyName');
  });

  it('a cashier cannot change it, and it needs sign-in', async () => {
    expect((await call(cashier, 'PUT', '/api/settings/company', { companyName: 'Nope' })).status).toBe(403);
    expect((await call(null, 'PUT', '/api/settings/company', { companyName: 'Nope' })).status).toBe(401);
    expect((await call(null, 'GET', '/api/settings/company')).status).toBe(401);
    expect((await call(cashier, 'GET', '/api/settings/company')).body.companyName).toBe('Acme Signs');
  });

  it('can be blanked (the app then shows just Shop Manager)', async () => {
    expect((await call(admin, 'PUT', '/api/settings/company', { companyName: '   ' })).body).toEqual({ companyName: '' });
    await call(admin, 'PUT', '/api/settings/company', { companyName: 'Acme Signs' });
  });

  it('the sign-in status exposes the company name, publicly and only that', async () => {
    const s = await call(null, 'GET', '/api/auth/status');
    expect(s.status).toBe(200);
    expect(s.body.companyName).toBe('Acme Signs');
    expect(Object.keys(s.body).sort()).toEqual(['accounts', 'companyName', 'needsSetup']);
  });

  it('/api/health reports app "shop-manager"', async () => {
    expect((await call(null, 'GET', '/api/health')).body.app).toBe('shop-manager');
  });
});
