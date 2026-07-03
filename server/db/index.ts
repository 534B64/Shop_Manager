import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema/index.js';

// Single SQLite file — rides the NAS → cloud backup pipeline as-is.
const dbPath = process.env.DB_PATH ?? './data/dp-erp.db';
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });

export const db = drizzle(client, { schema });

export async function runMigrations() {
  // WAL keeps reads fast while a write is in flight — multiple counter PCs.
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(db, { migrationsFolder: path.join(here, 'migrations') });
}
