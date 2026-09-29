// Runs in its OWN short-lived process (started by backup.ts). Why a separate
// process: on Windows the libsql library keeps a database file open after
// client.close() until the process exits (or the garbage collector happens to
// run), and a file that is open cannot be renamed. Backup and restore rename
// the files they check, so every look inside a file that is about to be
// renamed happens here; when this process exits, the file is really released.
//
// Plain JavaScript on purpose: it is started with `node`, with no TypeScript
// loader. Request = base64 JSON in argv[2]; reply = one JSON line on stdout.
//   { op: 'inspect', file, integrity, keyTables, dataTables }
//   { op: 'migrate', file, folder }
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

async function tableNames(c) {
  const r = await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(r.rows.map((row) => String(row.name)));
}

async function inspect(c, req) {
  let integrity = 'ok';
  if (req.integrity !== false) {
    const rows = (await c.execute('PRAGMA integrity_check')).rows;
    integrity = rows.map((r) => String(Object.values(r)[0])).join('; ');
  }
  const tables = await tableNames(c);
  const counts = {};
  for (const t of req.keyTables) {
    if (tables.has(t)) counts[t] = Number((await c.execute(`SELECT count(*) AS c FROM "${t}"`)).rows[0].c);
  }
  let migrations = [];
  let lastMigrationAt = 0;
  if (tables.has('__drizzle_migrations')) {
    const rows = (await c.execute('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id')).rows;
    migrations = rows.map((r) => String(r.hash));
    lastMigrationAt = rows.length ? Number(rows[rows.length - 1].created_at) : 0;
  }
  let dataset = null;
  if (tables.has('settings')) {
    const v = (await c.execute("SELECT value FROM settings WHERE key = 'dataset'")).rows[0]?.value;
    dataset = v === 'demo' || v === 'production' ? v : null;
  }
  let hasData = false;
  for (const t of req.dataTables ?? []) {
    if (!tables.has(t)) continue;
    if ((await c.execute(`SELECT 1 FROM "${t}" LIMIT 1`)).rows.length > 0) { hasData = true; break; }
  }
  return { integrity, counts, migrations, lastMigrationAt, dataset, hasData };
}

async function main() {
  const req = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
  const c = createClient({ url: `file:${req.file}` });
  let out;
  if (req.op === 'inspect') {
    out = await inspect(c, req);
  } else if (req.op === 'migrate') {
    // Rollback-journal mode while migrating: the file stays one self-contained file.
    await c.execute('PRAGMA journal_mode = DELETE');
    await c.execute('PRAGMA foreign_keys = ON');
    await migrate(drizzle(c), { migrationsFolder: req.folder });
    out = { ok: true };
  } else {
    throw new Error(`unknown op ${req.op}`);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().then(
  () => process.exit(0),
  (err) => { process.stderr.write(`${err && err.message ? err.message : err}\n`); process.exit(1); },
);
