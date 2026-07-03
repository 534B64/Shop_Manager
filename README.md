# Shop Manager

ERP/POS for Decals Plus. See `CONTEXT.md` (business background), `CLAUDE.md` (project rules), `TASKS.md` (build plan).

## Quick start (Windows)

Double-click, in order: `batch\1-Install.bat` → `batch\2-Seed-Database.bat` → `batch\3-Start-Dev.bat`. The browser opens automatically. `4-Start-Production.bat` builds and runs the single-server production mode on `:3000`.

`5-Start-Hidden.bat` does the same as 4 but with **no console window** (waits ~15s for the build, then opens the browser). Because there's no window to close, stop it with `6-Stop-Hidden.bat`.

Requires Node.js LTS (`winget install OpenJS.NodeJS.LTS`).

## Development (any OS)

```bash
npm install
npm run db:migrate   # creates ./data/dp-erp.db
npm run db:seed      # realistic shop data
npm run dev          # client on :5173 (proxies /api), server on :3000
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
