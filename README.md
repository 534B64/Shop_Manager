# Shop Manager

Shop Manager runs a small custom-graphics shop: quotes and job tracking, the counter register, payments and the cash drawer, inventory and reordering, and customers. It was built for Decals Plus and works for any similar 1-5 person shop.

It runs on **one Windows PC in your shop** (the "shop PC"). Everyone else opens it in a web browser on the shop wifi - nothing to install on the other PCs or phones. Your data stays in your shop: one database file on the shop PC, backed up every night.

## Install in 3 steps

1. **Download** the app from GitHub: green **Code** button, then **Download ZIP**.
2. **Unzip** it to a folder on the shop PC, for example `C:\ShopManager`.
   - A plain folder like this is the safest choice. A folder inside OneDrive or Dropbox also works, but syncing can lock the database file while the shop is busy. If you keep it in OneDrive, back up the `data\backups` folder separately as well.
3. **Double-click `Setup.bat`** and answer the questions. It needs internet for a few minutes and takes care of everything else: the engine that runs the app (no admin rights needed), your shop name, your first admin account, desktop shortcuts, and - if you say yes - the one Windows permission other devices need.

When it finishes it shows the address to open, for example **`http://decalsplus.local`**. You can run `Setup.bat` again any time; it never touches your shop data.

## Open it on other devices

On any PC or phone on the shop wifi, type the address Setup showed you (for example `decalsplus.local`) in the browser. Bookmark it.

- **Some Android phones cannot open `.local` names.** Use the numbers-only address instead (for example `192.168.1.20`). The app shows both under **Settings, Shop, Open on other devices**.
- If a device cannot connect at all, run `Setup.bat` again on the shop PC and say yes to the firewall question. Only devices on the same wifi or network can connect.

## Update

When a new version is out:

1. Download the new ZIP from GitHub and unzip it **over the same folder** (say yes to replace files). Your shop data is in the `data` folder, which the ZIP does not contain, so it is not overwritten.
2. Double-click **`Update.bat`**.

It backs up your data first, stops the app for a minute, installs the new version, starts the app again and opens it. If the backup fails it stops before changing anything.

## Back up

The app backs itself up **every night at 2 AM** while the shop PC is on. The backups are in `data\backups` inside the app folder; each one is checked when it is made, and the last 14 days and 8 weeks are kept.

A backup on the same PC does not help if the PC dies, so **now and then copy the `data\backups` folder** to a USB drive or a cloud folder. To restore, see `docs/BACKUP.md`.

## Get help

- The app is not opening? Double-click **Start Shop Manager** on the desktop, wait a minute, then try again. Run `Setup.bat` again if a shortcut is missing.
- Something looks wrong after an update? Your backups are in `data\backups`; `docs/BACKUP.md` explains restoring one.
- The app writes a daily log to `data\logs` - include the newest file when you ask for help.
- Open an issue on the project's GitHub page and describe what you clicked and what you saw.

## For developers

```bash
npm install
npm run db:seed                       # DEMO data into ./data/demo.db (labeled demo)
DB_PATH=./data/demo.db npm run dev     # client on :5173 (proxies /api), server on :3000
npm test                              # vitest
npm run typecheck                     # tsc --noEmit
```

Project rules: `CLAUDE.md`. Business background: `CONTEXT.md`. Build plan: `TASKS.md`. Technical deployment (Windows launchers, port and address details, Docker/NAS): `DEPLOY.md`. Backups and restore: `docs/BACKUP.md`. Why installs work the way they do: `docs/adr/0010-local-install-and-address.md`.

```
Setup.bat, Update.bat   install and update for non-technical owners (call setup/*.ps1)
batch/      Windows double-click launchers (start, stop, demo data, tests)
setup/      PowerShell behind Setup.bat / Update.bat
public/     static assets
src/        client - React pages and components
server/     Fastify API + db/ (schema, migrations, seed) + lib/mdns.ts (the .local name)
shared/     domain constants and business rules used by client and server
data/       SQLite database, backups, logs (created at runtime, not in git)
runtime/    the app's own copy of Node.js (created by Setup.bat, not in git)
```

Database scripts (all read `DB_PATH`; the server default is `./data/dp-erp.db`):

```bash
npm run db:init-prod                   # clean PRODUCTION db: one admin, no sample data (refuses if the file has data)
npm run db:backup                      # verified VACUUM INTO copy into BACKUP_DIR (default: backups/ next to the db) + rotation
npm run db:restore -- <backup-file>    # app must be stopped; current db is set aside, never deleted
```

SQLite (via `@libsql/client` - no native compile step) with Drizzle. Schema in `server/db/schema/`; migrations checked in under `server/db/migrations/`; the server applies pending migrations at boot.
