// `npm run db:restore -- <backup-file>` — put a backup back as the live
// database (ADR 0008, docs/BACKUP.md). The app must be stopped. The current
// database is moved aside (never deleted) before the backup goes in.
import { restoreBackup, RestoreRollbackError } from './backup.js';

const backupFile = process.argv[2];
const dbPath = process.env.DB_PATH ?? './data/dp-erp.db';
if (!backupFile) {
  console.error('\nUsage: npm run db:restore -- <backup-file>\n  e.g. npm run db:restore -- data/backups/dp-erp-2026-09-26_020000.db\n');
  process.exit(1);
}
try {
  const r = await restoreBackup({ backupFile, dbPath });
  const rows = Object.entries(r.counts).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`
RESTORE OK
  restored:    ${r.from}
  into:        ${r.dbPath}
  dataset:     ${r.backupDataset ?? 'unlabeled'}
  migrations:  ${r.migrationsBefore} in the backup -> ${r.migrationsAfter} now${r.migrationsAfter > r.migrationsBefore ? ' (upgraded)' : ''}
  set aside:   ${r.setAside.length ? r.setAside.join('\n               ') : '(there was no current database)'}
  rows:        ${rows}
Start the app again and check today's jobs, payments and a stock count.
`);
  process.exit(0);
} catch (err) {
  if (err instanceof RestoreRollbackError) {
    console.error(`\nRESTORE FAILED — ${err.message}\nDO NOT start the app until you have done that.\n`);
  } else {
    console.error(`\nRESTORE REFUSED — ${(err as Error).message}\nThe current database was not changed.\n`);
  }
  process.exit(1);
}
