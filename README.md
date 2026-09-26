# Shop Manager

ERP/POS for Decals Plus. See `CONTEXT.md` (business background), `CLAUDE.md` (project rules), `TASKS.md` (build plan).

## Quick start (Windows)

Practice (DEMO data in `data\demo.db`): `batch\1-Install.bat` → `batch\2-Seed-Database.bat` → `batch\3-Start-Dev.bat`. The browser opens automatically.

Real shop (`data\dp-erp.db`): `batch\8-Init-Production.bat` once (see `docs/PRODUCTION-SETUP.md`), then `4-Start-Production.bat` builds and runs the single-server production mode on `:3000` with a nightly backup (`docs/BACKUP.md`).

`5-Start-Hidden.bat` does the same as 4 but with **no console window** (waits ~15s for the build, then opens the browser). Because there's no window to close, stop it with `6-Stop-Hidden.bat`.

Requires Node.js LTS (`winget install OpenJS.NodeJS.LTS`).

## Development (any OS)

```bash
npm install
npm run db:seed                       # DEMO data into ./data/demo.db (labeled demo)
DB_PATH=./data/demo.db npm run dev     # client on :5173 (proxies /api), server on :3000
```

Database scripts (all read `DB_PATH`; the server default is `./data/dp-erp.db`):

```bash
npm run db:init-prod                   # clean PRODUCTION db: one admin, no sample data (refuses if the file has data)
npm run db:backup                      # verified VACUUM INTO copy into BACKUP_DIR (default: backups/ next to the db) + rotation
npm run db:restore -- <backup-file>    # app must be stopped; current db is set aside, never deleted
```

## Project layout

```
batch/      Windows double-click launchers
public/     static assets (favicon.svg / favicon.ico)
src/        client — components/, pages/, lib/
server/     Fastify API + db/ (schema, migrations, seed)
shared/     domain constants used by client and server
data/       SQLite database (created at runtime, not in git)
```

Docs: `CONTEXT.md` (business), `CLAUDE.md` (project rules), `TASKS.md` (build plan).

## Tests & checks

```bash
npm test             # vitest
npm run typecheck    # tsc --noEmit
```

## Deploy to the NAS / shop server

```bash
docker compose up -d --build
```

Open `http://<server-ip>:3000` from any shop PC. Put the `./data` folder inside the NAS share that already backs up to the cloud — the entire database is the single file `data/dp-erp.db`.

## Database

SQLite (via `@libsql/client` — no native compile step, installs clean on any CPU/NAS) with Drizzle. Schema in `server/db/schema.ts`; migrations generated with `npm run db:generate` and checked in under `server/db/migrations/`. The server applies pending migrations at boot.
