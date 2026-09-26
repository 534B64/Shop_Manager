// Demo vs production data (ADR 0008). A `settings` row `dataset` labels a
// database 'demo' or 'production'; `datasetCreatedAt` records when. The scripts
// (seed, seed-perf, init-prod, restore) read the label through a raw libsql
// client so they can decide BEFORE touching the file; the server reads it
// through the settings module for /api/health and its startup log.
import fs from 'node:fs';
import path from 'node:path';

export type Dataset = 'demo' | 'production';

/** The production database's file name. Demo data never goes in a file named this. */
export const PROD_DB_NAME = 'dp-erp.db';

/** The subset of a libsql Client these helpers need. */
export interface SqlRunner {
  execute(stmt: string | { sql: string; args: (string | number | null)[] }): Promise<{ rows: unknown[] }>;
}

/** Tables whose rows mean "someone used this database". Migrations fill
 *  materials, suppliers and locations with the shop's starting data, so those
 *  don't count; any change made through the app also writes audit_log. */
const DATA_TABLES = ['users', 'customers', 'jobs', 'payments', 'customer_credits',
  'inventory_items', 'inventory_adjustments', 'cycle_counts', 'audit_log'];

async function tableNames(c: SqlRunner): Promise<Set<string>> {
  const r = await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(r.rows.map((row) => String((row as { name: string }).name)));
}

/** The label, or null when unlabeled (including a file with no settings table yet). */
export async function readDataset(c: SqlRunner): Promise<Dataset | null> {
  if (!(await tableNames(c)).has('settings')) return null;
  const r = await c.execute("SELECT value FROM settings WHERE key = 'dataset'");
  const v = (r.rows[0] as { value?: string } | undefined)?.value;
  return v === 'demo' || v === 'production' ? v : null;
}

/** True when any row exists in a table that only people (or seeds) fill. */
export async function hasBusinessData(c: SqlRunner): Promise<boolean> {
  const tables = await tableNames(c);
  for (const t of DATA_TABLES) {
    if (!tables.has(t)) continue;
    const r = await c.execute(`SELECT 1 FROM "${t}" LIMIT 1`);
    if (r.rows.length > 0) return true;
  }
  return false;
}

/** True when the file has tables but is not a Shop Manager database. */
export async function isForeignDb(c: SqlRunner): Promise<boolean> {
  const tables = await tableNames(c);
  return tables.size > 0 && !tables.has('__drizzle_migrations');
}

/** Label the database, only if it has no label yet. Never relabels. */
export async function markDataset(c: SqlRunner, dataset: Dataset, now = new Date()): Promise<void> {
  await c.execute({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['dataset', dataset] });
  await c.execute({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['datasetCreatedAt', now.toISOString()] });
}

export const isProdFileName = (dbPath: string) => path.basename(dbPath).includes(PROD_DB_NAME);

/**
 * The demo-seed rule. Returns why seeding must be refused, or null.
 *   production label             → refuse, always
 *   demo label                   → allowed (re-seeding is idempotent)
 *   unlabeled + named dp-erp.db  → refuse (that name is the real shop database)
 *   unlabeled + has data         → refuse (could be real data nobody labeled)
 *   unlabeled + empty            → allowed; the seed labels it demo
 */
export function demoSeedProblem(s: { dbPath: string; dataset: Dataset | null; hasData: boolean }): string | null {
  if (s.dataset === 'production') {
    return `${s.dbPath} is the PRODUCTION database (real shop data). Demo data can never be loaded into it.`;
  }
  if (s.dataset === 'demo') return null;
  if (isProdFileName(s.dbPath)) {
    return `${s.dbPath} is named like the real shop database (${PROD_DB_NAME}). Demo data goes in its own file — `
      + 'run it with DB_PATH=./data/demo.db (2-Seed-Database.bat does this for you).';
  }
  if (s.hasData) {
    return `${s.dbPath} already has data but no demo/production label, so it might be real. `
      + 'Refusing. Use a new file name, or move this file somewhere safe first.';
  }
  return null;
}

/** File-level facts init-prod decides on. */
export interface FileState { exists: boolean; size: number; walWithoutDb: boolean }

export function fileState(dbPath: string): FileState {
  const stat = fs.statSync(dbPath, { throwIfNoEntry: false });
  const wal = fs.statSync(`${dbPath}-wal`, { throwIfNoEntry: false });
  return { exists: !!stat, size: stat?.size ?? 0, walWithoutDb: !stat && !!wal && wal.size > 0 };
}

/**
 * The production-init rule. Returns why init must be refused, or null.
 * Allowed only for a missing file, an empty file, or a Shop Manager database
 * with no label and nothing anyone entered (the server may already have
 * created it on first start). There is deliberately no override flag: to
 * start over, move the file somewhere else yourself.
 */
export function prodInitProblem(s: {
  dbPath: string; file: FileState; dataset?: Dataset | null; hasData?: boolean; foreign?: boolean;
}): string | null {
  const moveIt = `Move ${s.dbPath} (and any -wal / -shm files next to it) to a safe folder first, then run this again.`;
  if (s.file.walWithoutDb) return `${s.dbPath}-wal exists without the database file — something is wrong. ${moveIt}`;
  if (!s.file.exists || s.file.size === 0) return null;
  if (s.foreign) return `${s.dbPath} is not a Shop Manager database. ${moveIt}`;
  if (s.dataset) return `${s.dbPath} is already labeled "${s.dataset}". ${moveIt}`;
  if (s.hasData) return `${s.dbPath} already has data in it. ${moveIt}`;
  return null;
}
