// `npm run db:mark-production` (ADR 0008 amendment): labels an existing real
// database, refuses every other case. The rule as a pure function, then the real
// script run as a child process against temp files.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { markProductionProblem, type FileState } from './db/dataset.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dperp-markprod-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function run(script: string, env: Record<string, string>, input = '') {
  const r = spawnSync(process.execPath, [TSX, path.join(here, 'db', script)], {
    env: { ...process.env, CONFIRM: '', ...env }, encoding: 'utf8', input, timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
async function q(file: string, sql: string) {
  const c = createClient({ url: `file:${file}` });
  try { return (await c.execute(sql)).rows.map((r) => ({ ...r })); } finally { c.close(); }
}
/** An "old" real database: has an account and an audit row, but no dataset label. */
async function oldRealDb(name: string) {
  const file = path.join(root, name, 'dp-erp.db');
  const made = run('init-prod.ts', { DB_PATH: file, INIT_ADMIN_NAME: 'Owner', INIT_ADMIN_PIN: '8642' });
  expect(made.code, made.out).toBe(0);
  const c = createClient({ url: `file:${file}` });
  await c.execute("DELETE FROM settings WHERE key IN ('dataset', 'datasetCreatedAt')");
  c.close();
  return file;
}

describe('mark-production rule', () => {
  const none: FileState = { exists: false, size: 0, walWithoutDb: false };
  const some: FileState = { exists: true, size: 4096, walWithoutDb: false };
  it('allows an unlabeled Shop Manager database that holds shop data', () => {
    expect(markProductionProblem({ dbPath: 'd', file: some, dataset: null, hasData: true })).toBeNull();
  });
  it('refuses when already labeled, either way', () => {
    expect(markProductionProblem({ dbPath: 'd', file: some, dataset: 'production', hasData: true })).toMatch(/already labeled PRODUCTION/);
    expect(markProductionProblem({ dbPath: 'd', file: some, dataset: 'demo', hasData: true })).toMatch(/labeled DEMO/);
  });
  it('refuses a database with no shop data (db:init-prod is the tool), a missing file, and a foreign file', () => {
    expect(markProductionProblem({ dbPath: 'd', file: some, dataset: null, hasData: false })).toMatch(/db:init-prod/);
    expect(markProductionProblem({ dbPath: 'd', file: none })).toMatch(/nothing to label/);
    expect(markProductionProblem({ dbPath: 'd', file: some, foreign: true })).toMatch(/not a Shop Manager/);
  });
});

describe('db:mark-production script', () => {
  it('labels an old real database after CONFIRM=PRODUCTION and writes an audit row', async () => {
    const file = await oldRealDb('a');
    const before = (await q(file, 'SELECT count(*) AS n FROM users'))[0].n;
    const r = run('mark-production-cli.ts', { DB_PATH: file, CONFIRM: 'PRODUCTION' });
    expect(r.code, r.out).toBe(0);
    expect(await q(file, "SELECT value FROM settings WHERE key = 'dataset'")).toEqual([{ value: 'production' }]);
    expect((await q(file, "SELECT value FROM settings WHERE key = 'datasetCreatedAt'"))[0].value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await q(file, "SELECT action, entity FROM audit_log WHERE action = 'dataset.mark_production'"))
      .toEqual([{ action: 'dataset.mark_production', entity: 'setting' }]);
    expect((await q(file, 'SELECT count(*) AS n FROM users'))[0].n).toBe(before); // nothing else changed
  }, 90_000);

  it('asks the person to type PRODUCTION; anything else changes nothing', async () => {
    const file = await oldRealDb('b');
    const no = run('mark-production-cli.ts', { DB_PATH: file }, 'yes\n');
    expect(no.code).toBe(1);
    expect(no.out).toMatch(/REFUSED.*not confirmed/s);
    expect(await q(file, "SELECT count(*) AS n FROM settings WHERE key = 'dataset'")).toEqual([{ n: 0 }]);
    const wrong = run('mark-production-cli.ts', { DB_PATH: file, CONFIRM: 'yes' });
    expect(wrong.code).toBe(1);
    const yes = run('mark-production-cli.ts', { DB_PATH: file }, 'PRODUCTION\n');
    expect(yes.code, yes.out).toBe(0);
    expect(await q(file, "SELECT value FROM settings WHERE key = 'dataset'")).toEqual([{ value: 'production' }]);
  }, 120_000);

  it('refuses a database that is already labeled (production or demo) and never relabels', async () => {
    const file = await oldRealDb('c');
    expect(run('mark-production-cli.ts', { DB_PATH: file, CONFIRM: 'PRODUCTION' }).code).toBe(0);
    const again = run('mark-production-cli.ts', { DB_PATH: file, CONFIRM: 'PRODUCTION' });
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/already labeled PRODUCTION/);

    const demo = path.join(root, 'd', 'demo.db');
    expect(run('seed.ts', { DB_PATH: demo }).code).toBe(0);
    const d = run('mark-production-cli.ts', { DB_PATH: demo, CONFIRM: 'PRODUCTION' });
    expect(d.code).toBe(1);
    expect(d.out).toMatch(/labeled DEMO/);
    expect(await q(demo, "SELECT value FROM settings WHERE key = 'dataset'")).toEqual([{ value: 'demo' }]);
  }, 120_000);

  it('refuses a missing database and one with no shop data, creating nothing', async () => {
    const missing = path.join(root, 'e', 'dp-erp.db');
    const m = run('mark-production-cli.ts', { DB_PATH: missing, CONFIRM: 'PRODUCTION' });
    expect(m.code).toBe(1);
    expect(m.out).toMatch(/nothing to label/);
    expect(fs.existsSync(missing)).toBe(false);

    const empty = path.join(root, 'f', 'dp-erp.db');
    fs.mkdirSync(path.dirname(empty), { recursive: true });
    expect(run('migrate-cli.ts', { DB_PATH: empty }).code).toBe(0); // schema + starter price book, no accounts or jobs
    const e = run('mark-production-cli.ts', { DB_PATH: empty, CONFIRM: 'PRODUCTION' });
    expect(e.code, e.out).toBe(1);
    expect(e.out).toMatch(/no shop data.*db:init-prod/s);
    expect(await q(empty, "SELECT count(*) AS n FROM settings WHERE key = 'dataset'")).toEqual([{ n: 0 }]);
  }, 120_000);

  it('does not upgrade the live database: pending migrations are refused', async () => {
    const file = await oldRealDb('g');
    const c = createClient({ url: `file:${file}` });
    await c.execute('DELETE FROM __drizzle_migrations WHERE rowid = (SELECT max(rowid) FROM __drizzle_migrations)');
    const applied = (await c.execute('SELECT count(*) AS n FROM __drizzle_migrations')).rows[0].n;
    c.close();
    const r = run('mark-production-cli.ts', { DB_PATH: file, CONFIRM: 'PRODUCTION' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Start the app once so it updates the database, then run this again/);
    expect(await q(file, "SELECT count(*) AS n FROM settings WHERE key = 'dataset'")).toEqual([{ n: 0 }]);
    expect((await q(file, 'SELECT count(*) AS n FROM __drizzle_migrations'))[0].n).toBe(applied); // not migrated
  }, 90_000);

  it('refuses, with no audit row and no "Done", when the label row could not be written', async () => {
    const file = await oldRealDb('h');
    const c = createClient({ url: `file:${file}` });
    await c.execute("INSERT INTO settings (key, value) VALUES ('dataset', 'something-else')"); // reads as unlabeled, but the row exists
    c.close();
    const r = run('mark-production-cli.ts', { DB_PATH: file, CONFIRM: 'PRODUCTION' });
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/Done\./);
    expect(r.out).toMatch(/label was not written/);
    expect(await q(file, "SELECT count(*) AS n FROM audit_log WHERE action = 'dataset.mark_production'")).toEqual([{ n: 0 }]);
    expect(await q(file, "SELECT count(*) AS n FROM settings WHERE key = 'datasetCreatedAt'")).toEqual([{ n: 0 }]);
  }, 90_000);
});
