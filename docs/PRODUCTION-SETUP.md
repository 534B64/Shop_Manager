# Production setup — starting the real shop database

Before the first real sale, the app needs a **clean production database**: your price book,
one admin account (you), and nothing fake. This page is how to make one, how to switch over
from the practice data, and how to confirm you did it right.
Why it works this way: `docs/adr/0008-backups-and-dataset-separation.md`.

---

## Demo data vs production data

Every database is labeled one or the other, and the app treats them differently:

| | Demo data | Production data |
|---|---|---|
| What it is | Practice: fake customers and jobs, public demo PINs (Josiah 1234 / Amy 2222 / Sam 3333) | Your real shop: real sales, real money, real stock |
| File | `data/demo.db` | `data/dp-erp.db` |
| Made by | `2-Seed-Database.bat` (`npm run db:seed`) | `8-Init-Production.bat` / `npm run db:init-prod` — once |
| In the app | A coloured **DEMO DATA** strip across the top of every page | No strip |

Safety rails:
- Demo data can **never** be loaded into a production database — the seed refuses.
- The seed also refuses a file named `dp-erp.db` unless it's already labeled demo, and any
  unlabeled database that has data in it (it might be real).
- `db:init-prod` refuses any file that already has anything in it. There is no "erase it
  anyway" option on purpose: to start over, you move the old file away yourself.
- A restore refuses to put demo data over a production database.

---

## On the NAS (the normal setup)

Do this after `DEPLOY.md` Steps 1–4 (container built and reachable). Takes 5 minutes.

### If the container has never had any data (brand-new install)

1. In Container Manager, make sure the **dp-erp** container is **running**. On its first start
   it creates an empty database — that's fine, init-prod accepts an empty one.
2. **Don't** fill in the app's first-run "create admin" screen in the browser (that makes an
   unlabeled account, and init-prod would then refuse; if it already happened, follow
   "Switching from demo to production" below).
3. **Container Manager → Container → dp-erp → Action → Open terminal** (on some versions:
   Details → **Terminal** tab) → **Create** → choose `bash`. In the black window type:

   ```
   npm run db:init-prod
   ```

4. It asks for the **admin name** and a **PIN** (4–12 digits), twice. The PIN is visible while you
   type — make sure nobody is watching. It prints `Production database ready … dataset: production`.
5. **Container Manager → dp-erp → Restart** (so the log shows the new label).
6. Confirm (below).

(Same thing over SSH: `cd /volume1/Backup/dp-erp && sudo docker compose exec dp-erp npm run db:init-prod`.)

### Switching from demo to production

If the NAS has been running with practice data (or you've been testing on it):

1. **Container Manager → dp-erp → Stop.**
2. **File Station → dp-erp/data** → make a folder `old-practice-<today's date>`.
3. **Move** into it: `dp-erp.db`, `dp-erp.db-wal`, `dp-erp.db-shm`, `dp-erp.db.server-lock`
   (whichever are there) **and the whole `backups` folder** (those are backups of the practice data).
4. **Start** the container, then do steps 3–6 of the brand-new install above.

The practice files stay in `old-practice-…` until you delete them yourself.

---

## On a Windows PC (only if the shop runs the app from a PC instead of the NAS)

1. Double-click `batch\8-Init-Production.bat`. Type the admin name and PIN when asked.
   - If it says `REFUSED … already has data`: close any running Shop Manager window, move
     `data\dp-erp.db` (and `dp-erp.db-wal`, `dp-erp.db-shm`) into another folder, run it again.
2. Start the app with `batch\4-Start-Production.bat` (or `5-Start-Hidden.bat`). Both always use
   `data\dp-erp.db` and back up nightly at 2 AM into `data\backups`.
3. `2-Seed-Database.bat` and `3-Start-Dev.bat` stay for practice — they only ever use `data\demo.db`.

---

## Confirm it worked

- [ ] Open the app from a shop PC. **There is no DEMO DATA strip** at the top.
- [ ] The sign-in list shows **only your admin name** — no Josiah/Amy/Sam demo accounts.
- [ ] Sign in with your PIN. Orders, Customers and Inventory are **empty**; Materials shows your price book.
- [ ] Container Manager → dp-erp → **Log** has a line ending `dataset: PRODUCTION`
      (and one saying `daily backup scheduled at 02:00`).
- [ ] **Settings → Accounts**: add each person with their role (cashier / manager / admin) and a PIN.
- [ ] Next morning: `data/backups` has its first file (see `docs/BACKUP.md`, daily check).
      Take one by hand right away if you like: `npm run db:backup` in the container terminal.

If you ever see the DEMO DATA strip on the shop's real app, **stop ringing up sales** — the app is
pointed at practice data. Check which file the log line names.

## For developers

- `npm run db:init-prod` — target `DB_PATH` (default `./data/dp-erp.db`); admin from
  `INIT_ADMIN_NAME` / `INIT_ADMIN_PIN` or prompts.
- `npm run db:seed` — target `DB_PATH` (default `./data/demo.db`). Run the dev server on it with
  `DB_PATH=./data/demo.db npm run dev`.
- `GET /api/health` returns `dataset: 'demo' | 'production' | null` (null = unlabeled, e.g. a
  database made before this existed or by the first-run page).
