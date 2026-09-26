// `npm run db:backup` — one verified backup of DB_PATH into BACKUP_DIR, then
// rotation (ADR 0008, docs/BACKUP.md). Safe while the app is running.
// Exit code 0 only when the copy passed every check.
import { backupConfigFromEnv, backupDatabase } from './backup.js';

const dbPath = process.env.DB_PATH ?? './data/dp-erp.db';
try {
  const cfg = backupConfigFromEnv(process.env, dbPath);
  const r = await backupDatabase({ dbPath, backupDir: cfg.backupDir, keepDaily: cfg.keepDaily, keepWeekly: cfg.keepWeekly });
  const rows = Object.entries(r.counts).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`
BACKUP OK
  file:        ${r.file}
  size:        ${(r.bytes / 1e6).toFixed(2)} MB in ${r.ms} ms
  checks:      integrity_check ok · row counts match the live database · ${r.migrations} migrations match
  dataset:     ${r.dataset ?? 'unlabeled'}
  rows:        ${rows}
  rotation:    keeping ${r.kept.length} backup(s) (${cfg.keepDaily} daily / ${cfg.keepWeekly} weekly)${r.removed.length ? `, removed ${r.removed.join(', ')}` : ''}
`);
  process.exit(0);
} catch (err) {
  console.error(`\nBACKUP FAILED — ${(err as Error).message}\nNothing was rotated; older backups are untouched.\n`);
  process.exit(1);
}
