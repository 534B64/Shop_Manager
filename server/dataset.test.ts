// Phase 4 (ADR 0008): demo vs production data. The rules as pure functions,
// then the real scripts (init-prod, demo seed) run as child processes against
// temp files — exactly what a person running `npm run …` gets.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { demoSeedProblem, prodInitProblem, prodInitAlreadySetUp, restoreDatasetProblem, type FileState } from './db/dataset.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dperp-dataset-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(script: string, env: Record<string, string>) {
  const r = spawnSync(process.execPath, [TSX, path.join(here, 'db', script)], {
    env: { ...process.env, ...env }, encoding: 'utf8', input: '', timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
async function q(file: string, sql: string) {
  const c = createClient({ url: `file:${file}` });
  try { return (await c.execute(sql)).rows.map((r) => ({ ...r })); } finally { c.close(); }
}

describe('demo seed rule', () => {
  const at = (dbPath: string, dataset: 'demo' | 'production' | null, hasData: boolean) =>
    demoSeedProblem({ dbPath, dataset, hasData });
  it('never seeds a production-labeled database, whatever its name', () => {
    expect(at('./data/demo.db', 'production', false)).toMatch(/PRODUCTION/);
    expect(at('/tmp/x.db', 'production', true)).toMatch(/PRODUCTION/);
  });
  it('re-seeds a demo-labeled database, even one named dp-erp.db', () => {
    expect(at('./data/demo.db', 'demo', true)).toBeNull();
    expect(at('./data/dp-erp.db', 'demo', true)).toBeNull();
  });
  it('refuses an unlabeled dp-erp.db even when empty, and any unlabeled database with data', () => {
    expect(at('./data/dp-erp.db', null, false)).toMatch(/real shop database/);
    expect(at('/app/data/dp-erp.db', null, true)).toMatch(/real shop database/);
    expect(at('./data/shop.db', null, true)).toMatch(/might be real/);
  });
  it('seeds a new or empty unlabeled file with another name', () => {
    expect(at('./data/demo.db', null, false)).toBeNull();
  });
});

describe('restore rule', () => {
  type D = 'demo' | 'production' | null;
  const at = (dbPath: string, current: D, currentHasData: boolean, backup: D) =>
    restoreDatasetProblem({ dbPath, current, currentHasData, backup });
  it('a production backup can go anywhere', () => {
    expect(at('/data/dp-erp.db', 'production', true, 'production')).toBeNull();
    expect(at('/data/dp-erp.db', null, false, 'production')).toBeNull();
  });
  it('never puts demo or unlabeled data over production', () => {
    expect(at('/data/shop.db', 'production', true, 'demo')).toMatch(/PRODUCTION/);
    expect(at('/data/shop.db', 'production', false, null)).toMatch(/PRODUCTION/);
  });
  it('refuses a non-production backup into dp-erp.db or over a database with data, unless both are demo', () => {
    expect(at('/data/dp-erp.db', null, false, 'demo')).toMatch(/real shop database/);
    expect(at('/data/dp-erp.db', null, false, null)).toMatch(/real shop database/);
    expect(at('/data/shop.db', null, true, 'demo')).toMatch(/has data/);
    expect(at('/data/demo.db', 'demo', true, null)).toMatch(/has data/);
    expect(at('/data/demo.db', 'demo', true, 'demo')).toBeNull();
    expect(at('/data/dp-erp.db', 'demo', true, 'demo')).toBeNull();
  });
  it('allows a non-production backup into a new or empty file with another name', () => {
    expect(at('/tmp/restore-test.db', null, false, 'demo')).toBeNull();
    expect(at('/tmp/restore-test.db', null, false, null)).toBeNull();
  });
});

describe('production init rule', () => {
  const none: FileState = { exists: false, size: 0, walWithoutDb: false };
  const some: FileState = { exists: true, size: 4096, walWithoutDb: false };
  it('allows a missing or empty file, or an unused Shop Manager database', () => {
    expect(prodInitProblem({ dbPath: 'd', file: none })).toBeNull();
    expect(prodInitProblem({ dbPath: 'd', file: { exists: true, size: 0, walWithoutDb: false } })).toBeNull();
    expect(prodInitProblem({ dbPath: 'd', file: some, dataset: null, hasData: false, foreign: false })).toBeNull();
  });
  it('refuses anything with data, a label, a foreign schema, or an orphan -wal — no override exists', () => {
    expect(prodInitProblem({ dbPath: 'd', file: some, hasData: true })).toMatch(/already has data/);
    expect(prodInitProblem({ dbPath: 'd', file: some, dataset: 'demo' })).toMatch(/labeled "demo"/);
    expect(prodInitProblem({ dbPath: 'd', file: some, dataset: 'production' })).toMatch(/labeled "production"/);
    expect(prodInitProblem({ dbPath: 'd', file: some, foreign: true })).toMatch(/not a Shop Manager/);
    expect(prodInitProblem({ dbPath: 'd', file: { exists: false, size: 0, walWithoutDb: true } })).toMatch(/-wal/);
  });
});

describe('scripts', () => {
  const prod = path.join(root, 'site', 'dp-erp.db');
  const admin = { INIT_ADMIN_NAME: 'Owner', INIT_ADMIN_PIN: '8642' };

  it('db:init-prod creates a production database with exactly one admin and no demo data', async () => {
    const r = run('init-prod.ts', { DB_PATH: prod, ...admin });
    expect(r.code, r.out).toBe(0);
    expect(await q(prod, 'SELECT name, role FROM users')).toEqual([{ name: 'Owner', role: 'admin' }]);
    expect(await q(prod, "SELECT value FROM settings WHERE key = 'dataset'")).toEqual([{ value: 'production' }]);
    expect((await q(prod, "SELECT value FROM settings WHERE key = 'datasetCreatedAt'"))[0].value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const t of ['customers', 'jobs', 'payments', 'inventory_items']) {
      expect((await q(prod, `SELECT count(*) AS n FROM ${t}`))[0].n, t).toBe(0);
    }
    expect((await q(prod, "SELECT action FROM audit_log"))).toEqual([{ action: 'dataset.init_production' }]);
  }, 60_000);

  it('db:init-prod refuses a second time, and refuses a bad PIN before creating anything', async () => {
    const again = run('init-prod.ts', { DB_PATH: prod, ...admin });
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/REFUSED.*already labeled "production"/s);
    const other = path.join(root, 'other', 'dp-erp.db');
    const bad = run('init-prod.ts', { DB_PATH: other, INIT_ADMIN_NAME: 'X', INIT_ADMIN_PIN: '12' });
    expect(bad.code).toBe(1);
    expect(fs.existsSync(other)).toBe(false);
  }, 60_000);

  it('db:seed refuses the production database and an unlabeled dp-erp.db; seeds and labels demo.db', async () => {
    const onProd = run('seed.ts', { DB_PATH: prod });
    expect(onProd.code).toBe(1);
    expect(onProd.out).toMatch(/PRODUCTION/);
    expect(await q(prod, 'SELECT count(*) AS n FROM users')).toEqual([{ n: 1 }]);

    const unlabeled = path.join(root, 'fresh', 'dp-erp.db');
    const onName = run('seed.ts', { DB_PATH: unlabeled });
    expect(onName.code).toBe(1);
    expect(fs.existsSync(unlabeled)).toBe(false); // refused before creating the file

    const demo = path.join(root, 'demo.db');
    const ok = run('seed.ts', { DB_PATH: demo });
    expect(ok.code, ok.out).toBe(0);
    expect(await q(demo, "SELECT value FROM settings WHERE key = 'dataset'")).toEqual([{ value: 'demo' }]);
    expect(run('seed.ts', { DB_PATH: demo }).code).toBe(0); // idempotent re-seed
    // …and a demo database can never become production.
    const init = run('init-prod.ts', { DB_PATH: demo, ...admin });
    expect(init.code).toBe(1);
  }, 120_000);
});

describe('prodInitAlreadySetUp (Setup re-run)', () => {
  it('leaves labeled or used databases alone, but still initializes a server-created empty one', () => {
    expect(prodInitAlreadySetUp({ dataset: 'production' })).toBe(true);
    expect(prodInitAlreadySetUp({ hasData: true })).toBe(true);
    expect(prodInitAlreadySetUp({ dataset: null, hasData: false })).toBe(false);
    expect(prodInitAlreadySetUp({ foreign: true, hasData: true })).toBe(false); // still refused by init-prod
  });
});
