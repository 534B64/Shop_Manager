// `npm run db:mark-production` — label an EXISTING real shop database as
// PRODUCTION (ADR 0008). For a database that was in use before labels existed:
// restore's safety rules (never put demo data over the real shop) depend on it.
//
// Target: DB_PATH (default ./data/dp-erp.db). Refuses if the database is already
// labeled (either way), or if it holds no shop data (use db:init-prod then).
// Asks you to type PRODUCTION to confirm (or set CONFIRM=PRODUCTION for scripts).
// Writes the label and one audit-log row; changes nothing else.
import readline from 'node:readline/promises';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileState, markProductionProblem, readDataset, hasBusinessData, isForeignDb, type Dataset } from './dataset.js';

const dbPath = process.env.DB_PATH ?? './data/dp-erp.db';
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

function fail(msg: string): never {
  console.error(`\ndb:mark-production: REFUSED — ${msg}\nNothing was changed.\n`);
  process.exit(1);
}

// 1. Is this database eligible? Read-only until you confirm.
const file = fileState(dbPath);
let facts: { foreign?: boolean; dataset?: Dataset | null; hasData?: boolean } = {};
if (file.exists && file.size > 0) {
  const c = createClient({ url: `file:${dbPath}` });
  try {
    facts = { foreign: await isForeignDb(c), dataset: await readDataset(c), hasData: await hasBusinessData(c) };
  } catch (err) {
    fail(`${dbPath} could not be read as a database (${(err as Error).message}).`);
  } finally {
    c.close();
  }
}
const problem = markProductionProblem({ dbPath, file, ...facts });
if (problem) fail(problem);

// 2. Confirm.
let answer = process.env.CONFIRM ?? '';
if (!answer) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nThis marks ${path.resolve(dbPath)} as your REAL shop database (PRODUCTION).`);
  console.log('Demo data can never be loaded into it afterwards, and a restore will only accept real backups.');
  console.log('It changes nothing else. It cannot be undone from the app.\n');
  answer = await rl.question('Type PRODUCTION and press Enter to confirm (anything else cancels): ');
  rl.close();
}
if (answer.trim().toUpperCase() !== 'PRODUCTION') fail('not confirmed (the word PRODUCTION was not typed).');

// 3. Label it, and write the audit row, in one transaction.
const c = createClient({ url: `file:${dbPath}` });
try {
  await c.execute('PRAGMA busy_timeout = 10000');
  await c.execute('PRAGMA foreign_keys = ON');
  await migrate(drizzle(c), { migrationsFolder }); // the same upgrade the app does at start; no-op when current
  const tx = await c.transaction('write');
  try {
    // Re-check inside the write lock in case something labeled it meanwhile.
    if ((await readDataset(tx)) !== null) throw new Error('the database was labeled while this ran');
    const at = new Date().toISOString();
    await tx.execute({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['dataset', 'production'] });
    await tx.execute({ sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['datasetCreatedAt', at] });
    await tx.execute({
      sql: 'INSERT INTO audit_log (at, user_id, action, entity, entity_id, before_json, after_json) VALUES (?, NULL, ?, ?, ?, NULL, ?)',
      args: [at, 'dataset.mark_production', 'setting', 'dataset',
        JSON.stringify({ dataset: 'production', markedAt: at, how: 'npm run db:mark-production' })],
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  } finally {
    tx.close();
  }
} catch (err) {
  fail(`could not write the label (${(err as Error).message}).`);
} finally {
  c.close();
}

console.log(`
Done. ${path.resolve(dbPath)} is now labeled PRODUCTION.
Check it: open http://localhost:3000/api/health — it should say "dataset":"production".
(No restart is needed; the app reads the label live.)
`);
process.exit(0);
