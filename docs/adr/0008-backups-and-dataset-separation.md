# ADR 0008 — Demo vs production data, backups, and restore

**Status:** accepted (2026-09-26). Phase 4 of hardening for real transactions.
Builds on ADR 0004 (accounts), 0005 (no hard deletes, `withTx`), 0006 (ledger).

## Context

The app is about to take real money. Three gaps:

- **Demo and real data could mix.** `npm run db:seed` (and `2-Seed-Database.bat`)
  wrote sample customers, jobs and three accounts with *published* PINs
  (Josiah 1234 / Amy 2222 / Sam 3333) into `data/dp-erp.db` — the same file the
  production launchers and the Docker image use. One double-click on the shop PC
  would put fake jobs and a known admin PIN into the real books. Nothing on screen
  said which data you were looking at.
- **"Backup" meant the cloud copying the live file.** The NAS → cloud job copies
  `dp-erp.db`, `-wal` and `-shm` whenever it runs; a copy taken mid-write is not
  guaranteed consistent, nobody had ever verified one, and there was no restore
  procedure beyond "copy the files back".
- **No tested restore.** Drill 2 (DRILLS.md) had never been run.

## Decision

### 1. A label inside the database

`settings` row `dataset` = `demo` | `production` (plus `datasetCreatedAt`). It
lives in the file, so it travels with backups, copies and renames — a file name
alone can't say what's inside. Written only by scripts (no API route), never
relabeled (`INSERT OR IGNORE`). No migration: `settings` already exists, and an
unlabeled database (null) stays valid for older installs.

- **`npm run db:init-prod`** (`server/db/init-prod.ts`): migrations, one admin
  from a prompt or `INIT_ADMIN_NAME`/`INIT_ADMIN_PIN`, the `production` label and
  one audit row, in one transaction. Allowed only on a missing/empty file or a
  Shop Manager database with no label and no rows in any people-filled table
  (users, customers, jobs, payments, credits, items, ledger, counts, audit log) —
  i.e. what the server creates on first start. **No override flag**: starting
  over means moving the file yourself, so erasing real data always takes a
  deliberate human act outside the app.
- **Demo seed rule** (`demoSeedProblem`): production label → refuse; demo label →
  allowed; unlabeled and named `dp-erp.db` → refuse (even when empty — that name
  *is* the production file); unlabeled with data → refuse (it might be real and
  nobody labeled it); unlabeled and empty → seed and label demo. The seed now
  defaults to `data/demo.db`; the dev launcher runs on demo.db; the production
  launchers pin `dp-erp.db`. The perf seeder and perf baseline additionally
  refuse any production-labeled file whatever its name.
- `GET /api/health` (public) returns `dataset`; the server logs it on start; the
  client shows a DEMO DATA strip when it is `demo` (isolated `DemoBanner`
  component so the parallel shell redesign merges cleanly). Unlabeled shows no
  strip — a false "demo" warning on real data would train people to ignore it.

### 2. Backups: `VACUUM INTO`, verified, rotated

`npm run db:backup` (`server/db/backup.ts`) runs `VACUUM INTO` on its own
connection — SQLite's own consistent snapshot under WAL, safe while the app
writes, and the result is one self-contained, compacted file. Alternatives: a
file copy (unsafe under WAL), the sqlite3 CLI `.backup` (not in the image; no
new dependencies), the online-backup C API (not exposed by `@libsql/client`).

The copy is written as `.partial`, verified, then renamed; a failed copy is
removed and rotation is skipped. Verification:
- `PRAGMA integrity_check` = ok;
- migration journal identical to the live file's (read before and after);
- row counts of key tables within [live count just before, live count just
  after]. Those tables can never lose rows (ADR 0005 triggers), so any snapshot
  taken during writes must land in that range — an exact check without stopping
  writes.

Rotation (by the date in the file name, not mtime, which cloud tools rewrite):
the newest backup of each of the last 14 days that have one, plus the newest of
each of the last 8 weeks, plus always the newest. Only files matching this
database's backup name pattern are ever deleted. Defaults via
`BACKUP_KEEP_DAILY`/`BACKUP_KEEP_WEEKLY`; `BACKUP_DIR` defaults to `backups/`
next to the database, i.e. `/app/data/backups` on the Docker volume, so the
existing NAS → cloud job carries them offsite.

### 3. Schedule inside the app

The server runs the same backup daily at `BACKUP_HOUR` (set to 2 in the Docker
image and the Windows production launchers; unset = off, so dev and tests never
back up), plus a catch-up a minute after start when the newest backup is over
26 hours old. Chosen over the NAS Task Scheduler / cron calling the npm script
because it needs **no NAS configuration** from a non-programmer, ships inside the
image, and survives re-deploys. Its one weakness — it only runs while the app
runs — is harmless: data only changes while the app runs, and the catch-up covers
a NAS that was off at 2 AM. The npm script stays for manual and extra backups.

### 4. Restore: refuse while running, prepare, then swap — never delete

`npm run db:restore -- <file>`:
1. **Running check — a heartbeat lock file.** The server writes
   `<db>.server-lock` at start, touches it every 30 s, removes it on
   SIGTERM/SIGINT/exit. Restore refuses while it is less than 90 s old.
   Rejected: a PID check (the restore runs in a different container — different
   PID namespace and host name — so a PID means nothing, and a killed container
   leaves a lock forever); SQLite exclusive locking (in WAL mode an idle server
   holds no lock that reliably blocks another connection). A crash leaves the
   file behind but its heartbeat goes stale on its own. Compose gets
   `init: true` so `docker stop` reaches the app. The other direction (wave 1
   fix): restore then writes `<db>.restore-lock` and the server refuses to start
   while it is under 10 minutes old (`server/restore-guard.ts`, imported before
   anything opens the database); restore also re-checks the heartbeat right
   before step 4.
2. **Check the backup** — integrity ok, a Shop Manager database, not made by a
   newer app version (its last migration is newer than ours), not a live copy
   with a `-wal` beside it, and the dataset rule (`restoreDatasetProblem`,
   mirroring the seed rule): a production backup may go anywhere; a demo or
   unlabeled backup never goes over production, into a file named `dp-erp.db`,
   or over a database that has data — except demo over demo.
3. **Prepare** — copy to `<db>.restoring`, run migrations there in
   rollback-journal mode (an older backup upgrades here; the server switches WAL
   back on at start), integrity check again.
4. **Set aside** the current database with its `-wal`/`-shm` as
   `<name>.pre-restore-<stamp>.db*` — renamed together so it stays openable,
   never deleted. Put back automatically if the final step fails.
5. **Swap** the prepared file into place.

The prepare-then-swap order means any failure leaves the current database
exactly as it was. Because a `VACUUM INTO` backup is a complete file, a manual
restore (stop, move files aside, copy a backup in as `dp-erp.db`, start) also
works — documented in `docs/BACKUP.md` for use without a terminal.

## Amendment 2026-09-28 - Windows file locks, labeling an existing database

- **Windows cannot rename an open file, and libsql keeps it open.** On Windows, `@libsql/client`
  (libsql 0.4.x) does not release a database file when `client.close()` is called - the handle lives
  until the process exits. Every nightly backup on the owner's Windows PC therefore failed at the final
  `rename(.partial -> .db)` with EBUSY. Fix: every look inside a file that is about to be renamed
  (checking the copy, migrating the `.restoring` copy, reading the current database's label before it
  is set aside) runs in a short-lived child process (`server/db/db-child.mjs`), so the file is really
  released before the rename. The rename/delete steps also retry EBUSY/EPERM/EACCES for ~10 s
  (`server/db/fs-retry.ts`; OneDrive and antivirus lock new files briefly), rotation and the lock
  files use the same retry, and `.partial` files older than a day are removed at the start of each run.
  Alternatives rejected: `node:sqlite` (the Docker image is Node 20), forcing garbage collection
  (unreliable), worker threads (a worker hung on exit in testing).
- **Labeling an existing real database is now a script**, not a hand edit:
  `npm run db:mark-production` (`batch/9-Mark-Production.bat`). It refuses if the database is
  already labeled either way, or has no shop data; needs the word PRODUCTION typed (or
  `CONFIRM=PRODUCTION`); writes the label and one `dataset.mark_production` audit row. This
  supersedes "a developer task, deliberately not a script" in Consequences below.
- **Stale-server guard.** `GET /api/health` also returns `version` and `build`; the client build id is
  compiled in at `npm run build` and written to `dist/build-id.json`, the server reads it once at start.
  A mismatch (or no `build` at all from an older server) shows an "out of date" banner. The Windows
  start scripts stop any running server first, so "Start" means "restart".

## Consequences

- Demo data can only reach a production-labeled database by someone editing the
  label by hand; a production DB can only be created on an empty file.
- A database made by the old first-run page or before this ADR is unlabeled: the
  server logs it as such and shows no banner. Labeling an existing *real* unlabeled
  database is `npm run db:mark-production` (amendment above; it was a hand edit at first).
- Recovery point is up to 24 h by default (one nightly backup). More frequent
  backups are one extra `npm run db:backup` from any scheduler; rotation keeps
  the newest per day.
- `pre-restore` copies and practice files accumulate until a person deletes them.
- Backups share the NAS disk with the live file; the cloud job is the offsite
  copy and must include `data/backups` (DRILLS.md Drill 2).
- Not verified inside a real container yet (signal delivery through `npx`, the
  terminal-based init) — the heartbeat makes restore safe either way.
