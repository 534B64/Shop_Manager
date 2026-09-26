import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema/index.js';

// Single SQLite file — rides the NAS → cloud backup pipeline as-is.
const dbPath = process.env.DB_PATH ?? './data/dp-erp.db';
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });

export const db = drizzle(client, { schema });
/** The drizzle handle type — `db` itself or the transaction handle `withTx`
 *  passes in. Cross-module functions take `dbx: Db = db` so a caller's
 *  transaction is used when there is one. */
export type Db = typeof db;

// ---- Transactions (Phase 1b, ADR 0005) ----
// Every mutation runs through withTx: one BEGIN IMMEDIATE … COMMIT on a
// dedicated writer connection, ROLLBACK on any throw. Why not db.transaction():
// @libsql/client hands its only connection to the transaction and lazily opens
// a fresh one for everything else — the fresh one loses `foreign_keys = ON`
// and the old one is never closed. A single long-lived writer connection
// avoids both. Writes are serialized in-process by a promise chain (one
// server, a handful of users), so a second request never trips SQLITE_BUSY
// against our own open transaction; reads on `db` keep working under WAL.
// Re-entrant: a withTx inside a withTx (e.g. requireApproval inside a route's
// transaction) joins the outer transaction.
const writerClient = createClient({ url: `file:${dbPath}` });
const writerDb: Db = drizzle(writerClient, { schema });
const txScope = new AsyncLocalStorage<Db>();
let writeQueue: Promise<unknown> = Promise.resolve();
let writerReady = false;

export async function withTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const outer = txScope.getStore();
  if (outer) return fn(outer);
  const run = async () => {
    if (!writerReady) {
      await writerClient.execute('PRAGMA foreign_keys = ON');
      // Only matters against OTHER processes (seed scripts, sqlite3 shell).
      await writerClient.execute('PRAGMA busy_timeout = 5000');
      writerReady = true;
    }
    await writerClient.execute('BEGIN IMMEDIATE');
    try {
      const result = await txScope.run(writerDb, () => fn(writerDb));
      await writerClient.execute('COMMIT');
      return result;
    } catch (err) {
      await writerClient.execute('ROLLBACK').catch(() => { /* already rolled back */ });
      throw err;
    }
  };
  const p = writeQueue.then(run, run);
  writeQueue = p.catch(() => undefined);
  return p;
}

export async function runMigrations() {
  // WAL keeps reads fast while a write is in flight — multiple counter PCs.
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.join(here, 'migrations') });
}
