# Backups and restore — Shop Manager

Plain-language procedure. Why it works this way: `docs/adr/0008-backups-and-dataset-separation.md`.

---

## The short version

- **Every night at 2 AM the app backs itself up.** Nothing to click.
- Backups are files in **`dp-erp/data/backups/`** on the NAS, named by date and time,
  e.g. `dp-erp-2026-09-26_020000.db`.
- Each backup is **checked the moment it's made** (the file is readable, nothing is
  damaged, and it holds the same number of jobs, payments, stock records, etc. as the
  live database). A copy that fails a check is thrown away and the error is written in
  the app's log. Older backups are never touched when that happens.
- It keeps **the last 14 days** (one per day) **and the last 8 weeks** (one per week).
  Older ones are removed automatically.
- The NAS's cloud backup copies that folder offsite, so a dead NAS doesn't take the
  backups with it.

---

## Backups on a Windows PC (OneDrive folder)

If the app runs from a PC instead of the NAS, the same nightly backup lands in `data\backups`
inside the Shop Manager folder. Two Windows-only things to know:

- **How to confirm a backup really finished.** A finished backup is a file named
  `dp-erp-2026-09-28_020000.db` (ends in `.db`). A file ending in **`.db.partial`** is a backup that
  did NOT finish - it is never a usable backup. Check `data\backups` each morning: there should be a
  `.db` file with last night's date and no new `.partial`. Or open a Command Prompt in the Shop
  Manager folder and run `npm run db:backup`: it must print `BACKUP OK`.
- **Why it used to fail (fixed 2026-09-28).** Windows will not rename a file that a program still has
  open, and the backup checked its copy and then renamed it while the checker still held it, so every
  backup stopped with `EBUSY: resource busy or locked` and left a `.partial` behind. Now the checking is
  done in a separate short-lived program (so the file is truly released), and the last step (giving the
  copy its final name) tries again for about 10 seconds if OneDrive or antivirus is touching the file at
  that moment. If it still cannot finish it says so in plain words and leaves the checked copy as `.partial`.
- **Leftover `.partial` files clean themselves up.** At the start of every backup run, `.partial` files
  older than a day are deleted. Finished backups are never touched by this.
- The same "let go of the file before renaming it" rule now applies to restore (moving the old
  database aside, putting the new one in), to deleting old backups, and to the restore/heartbeat
  marker files.

## Where backups live

| What | Where on the NAS | Notes |
|---|---|---|
| Live database | `dp-erp/data/dp-erp.db` (+ `dp-erp.db-wal`, `dp-erp.db-shm`) | Changes every second while the app runs. **Don't** copy it by hand as a "backup". |
| Nightly backups | `dp-erp/data/backups/dp-erp-YYYY-MM-DD_HHMMSS.db` | One file each, complete on its own. These are what you restore from. |
| Set-aside copies | `dp-erp/data/dp-erp.pre-restore-YYYY-MM-DD_HHMMSS.db` | Made by a restore: the database as it was just before. Never deleted automatically. |
| App running marker | `dp-erp/data/dp-erp.db.server-lock` | Tiny file the app updates every 30 s so a restore knows it's running. Harmless; ignore it. |
| Restore marker | `dp-erp/data/dp-erp.db.restore-lock` | Exists only while a restore runs; the app won't start while it's fresh. |

(`dp-erp` = the folder you made in `DEPLOY.md` Step 1. Inside the container it is `/app/data`.)

## How the cloud backup picks them up

The whole `dp-erp` folder sits in a NAS share that already goes to the cloud
(Hyper Backup or Cloud Sync on Synology). Check once, and again after any change to the backup setup:

1. Open the NAS backup app (e.g. **Hyper Backup**), open the backup task, **Edit → Folders**.
2. Make sure `dp-erp/data` is ticked — that includes `data/backups`.
3. If it runs on a schedule, set it **after 2 AM** (e.g. 3 AM) so each night's cloud copy
   includes that night's backup.
4. On the cloud side (or Hyper Backup's **Backup Explorer**), confirm you can see
   `data/backups/` with yesterday's file in it.

Why the backups folder matters more than the live file: the cloud tool may copy the live
database halfway through a sale. The files in `backups/` are finished and checked.

## Daily check (10 seconds)

Open **File Station → dp-erp/data/backups** and sort by name.

- OK: There's a file with **today's date** (or last night's, before 2 AM), and it's about the
  same size as the day before (it grows slowly over time).
- Problem: No file for last night → open **Container Manager → dp-erp → Log** and search for
  `BACKUP`. `BACKUP FAILED — …` explains why; `daily backup scheduled at 02:00` at the top of
  the log means the schedule is on. If the container wasn't running at 2 AM, it makes a
  catch-up backup a minute after it starts.

Want a backup right now (before an update, a big import, etc.)? See "Make a backup now" below.

---

## How to restore, step by step

Restoring puts the whole shop back to the moment the backup was taken. **Anything entered
after that moment is not in it** — have the paper receipts / notes from that window ready to
re-enter.

### Option A — no commands (File Station + Container Manager)

1. **Container Manager → Container → dp-erp → Stop.** Wait until it says Stopped.
2. **File Station → dp-erp/data.** Make a new folder named `pre-restore-` + today's date,
   e.g. `pre-restore-2026-10-03`.
3. **Move** (not copy) into that new folder: `dp-erp.db`, and `dp-erp.db-wal`,
   `dp-erp.db-shm`, `dp-erp.db.server-lock` if they are there. Never delete them — that's
   the database as it was, in case you need something from it.
4. Open `backups/`, pick the backup to restore (normally the newest), **Copy** it into
   `dp-erp/data`, then **Rename** the copy to exactly `dp-erp.db`.
5. **Container Manager → dp-erp → Start.** The app upgrades an older backup automatically as it starts.
6. Check it (see "After any restore" below).

### Option B — one command (does extra safety checks for you)

Needs SSH to the NAS (Control Panel → Terminal & SNMP → Enable SSH). From a PC (on some
NAS models the command is `docker-compose` with a dash instead of `docker compose`):

```
ssh youradmin@192.168.1.50
cd /volume1/Backup/dp-erp            # your dp-erp folder
sudo docker compose stop
sudo docker compose run --rm dp-erp npm run db:restore -- /app/data/backups/dp-erp-2026-10-03_020000.db
sudo docker compose start
```

It refuses (and changes nothing) if the app is still running, if the backup is damaged, if
it's demo or unlabeled data going into `dp-erp.db` or over a database that already has data
(only demo over demo is allowed), or if it came from a newer version of the app. While it works
it leaves a `dp-erp.db.restore-lock` file; the app refuses to start until the restore finishes
(a lock left by a crashed restore stops counting after 10 minutes), and the restore checks once
more that the app is not running right before it swaps the files.
It moves the current database aside to `dp-erp.pre-restore-<date>.db` (never deleted), puts
the backup in place, upgrades it, and prints the row counts. It says `RESTORE OK` at the end.

### After any restore

- Sign in. There must be **no coloured "DEMO DATA" strip** at the top.
- Today's / recent jobs are there up to the backup time, payments are there, one inventory
  count matches the shelf.
- Re-enter anything done after the backup time.
- Once you're sure all is well (a week later, say), you may delete old `pre-restore` copies.

---

## Monthly restore test (15 minutes, first Monday of the month)

A backup that was never restored is a hope, not a plan. This test restores the newest
backup **into a separate test folder** — the live app keeps running and nothing real is touched.

```
ssh youradmin@192.168.1.50
cd /volume1/Backup/dp-erp
ls data/backups                        # note the newest file name
sudo docker compose run --rm -e DB_PATH=/app/data/restore-test/dp-erp.db dp-erp \
  npm run db:restore -- /app/data/backups/<newest file>
```

- OK: It prints `RESTORE OK` with row counts — `jobs`, `payments`, `customers` should be close to
  what you expect (yesterday's total).
- Problem: `RESTORE REFUSED — the backup is damaged` → try the next-newest file and tell the developer.

Then delete the test folder: **File Station → dp-erp/data/restore-test → Delete.**
Write the date and the jobs count on the drill sheet (`DRILLS.md`, Drill 2).

Once or twice a year also do the full scratch-container version in `DRILLS.md` (opens the
restored copy in a browser).

## Make a backup now

```
sudo docker compose exec dp-erp npm run db:backup
```

Safe while the app is running. Prints `BACKUP OK` and the file name, or `BACKUP FAILED` and why.
(Without SSH: Container Manager → dp-erp → **Terminal** (or Action → Open terminal) →
Create → `bash`, then type `npm run db:backup`.)

## If the database is corrupt

Signs: the app shows errors like "database disk image is malformed", pages stop loading,
or the container keeps restarting.

1. **Don't delete anything and don't start re-entering data.** Stop the container.
2. Restore the **newest** backup (Option A or B above). Option B tells you straight away if a
   backup is damaged; with Option A, if the app still errors after starting, repeat with the
   next-older backup.
3. If every backup in `data/backups` is refused as damaged, the NAS disk itself may be failing:
   check **Storage Manager** for disk warnings, and restore `data/backups` from the **cloud** copy
   to a healthy location first.
4. Keep the damaged `pre-restore` copy. A developer can often pull the last hours of sales out of
   it (`sqlite3 … .recover`), which saves re-typing.
5. Re-enter what happened after the backup time from paper.

---

## Settings (for whoever maintains the NAS)

Set in `docker-compose.yml` (defaults are baked into the image):

| Setting | Default | Meaning |
|---|---|---|
| `BACKUP_HOUR` | `2` | Hour of the nightly backup, 0-23. Remove it to turn the nightly backup off. |
| `BACKUP_DIR` | `/app/data/backups` | Where backups go. Must stay inside the `/app/data` volume. |
| `BACKUP_KEEP_DAILY` | `14` | How many days get a kept backup. |
| `BACKUP_KEEP_WEEKLY` | `8` | How many weeks get a kept backup. |
| `TZ` | `America/Chicago` | Shop time zone (set in the Dockerfile and docker-compose.yml), so 2 means 2 AM shop time. Change both if the shop is elsewhere. |

Commands (inside the container, or from the project folder with Node): `npm run db:backup`,
`npm run db:restore -- <file>`. Both read `DB_PATH` (default `./data/dp-erp.db`). Rotation only
ever deletes files named like this database's backups in the backups folder.

---

## Drill transcript (2026-09-26, developer run in /tmp — not the NAS)

Scripted end-to-end run against a throwaway production database in `/tmp/sm-drill`
(`DB_PATH=/tmp/sm-drill/data/dp-erp.db`), the real server on port 3999:

1. `npm run db:init-prod` → `Production database ready … dataset: production … admin: Owner (the only account)`.
2. Started the app → log `dataset: PRODUCTION`; `/api/health` → `"dataset":"production"`; lock file present.
3. Started ringing up **400** jobs (customer + job + payment + stock item + receipt each) over HTTP and,
   2 s in, ran `npm run db:backup` → `BACKUP OK`, 1.48 MB in 26 ms, integrity ok, 16 migrations match,
   a consistent snapshot of **305** jobs / 305 payments / 305 items / 610 ledger rows / 1,527 audit rows.
4. `npm run db:restore` while the app ran → `RESTORE REFUSED — the app is running on this database …
   heartbeat is 4 s old`; exit 1, nothing changed.
5. Stopped the app with SIGTERM (what `docker stop` sends) → lock file removed.
6. `npm run db:restore -- …/dp-erp-2026-09-26_005113.db` → `RESTORE OK`; the live database (400 jobs)
   and its `-wal`/`-shm` moved to `dp-erp.pre-restore-2026-09-26_005117.db*`.
7. Restarted → `dataset: PRODUCTION`; `/api/jobs` → 305; `/api/inventory/reconcile` →
   `{"ok":true,"items":[],"balances":[]}`.
8. The set-aside copy still opens and verifies: 400 jobs / 400 payments / 800 ledger rows.

Not yet done: the same drill on the real NAS (Docker, Container Manager, cloud copy). That is
Drill 2 in `DRILLS.md`.
