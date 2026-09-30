# Deploying Shop Manager

Two ways to run it: on **a Windows PC** (the simple way, no Docker; first section) or on **a NAS with Docker** (the rest of this page).

## On a Windows PC (Setup.bat)

Owner-friendly steps are in `README.md`. The technical picture:

- **Install:** unzip the project, double-click `Setup.bat` (`setup/setup.ps1`). It downloads the official Node.js LTS zip (24.x) from nodejs.org into `runtime\node\` (checked against nodejs.org's SHA-256 list; no admin needed; every launcher puts `runtime\node` first on PATH, else uses the PC's Node), runs `npm ci` and `npm run build`, asks for the shop name and a hostname (saved in `data\shop.env` as `SHOP_NAME` / `SHOP_HOSTNAME`), creates the production database with `db:init-prod` only if none exists, adds desktop shortcuts and (optional) a Startup-folder shortcut, and adds the firewall rules (the only elevated step, `setup/firewall.ps1`, after asking). Re-running is safe. `Setup.bat -DryRun` prints the shortcut/startup/firewall changes without making them.
- **Update:** unzip the new version over the folder, double-click `Update.bat` (`setup/update.ps1`): optional `git pull` (only in a clean git clone), `npm run db:backup` (stops the update if it fails), stop the app, `npm ci`, `npm run build`, start, open. `data\` is never touched except the new backup file.
- **Address:** the server listens on **port 80** in production only once Setup has configured the install (a hostname in `datashop.env`); otherwise it stays on 3000 as before (env `PORT` overrides everything; if 80 is busy or refused it falls back to **3000** and logs which address to use). A small built-in mDNS responder (`server/lib/mdns.ts`, UDP 5353) answers `<hostname>.local` with the PC's current LAN IPv4 addresses. It starts only when a hostname is configured (env `SHOP_HOSTNAME` or `data\shop.env`) and `NODE_ENV=production`. `GET /api/health` lists `addresses` (the `.local` name plus `http://<LAN-IP>` for devices without mDNS, e.g. some Android phones).
- **Firewall:** node.exe needs inbound TCP 80 (and 3000) and UDP 5353 on Private networks. Setup adds them by passing the commands inline to an elevated PowerShell (`-EncodedCommand` built from a fixed template plus the checked node.exe path; nothing is run from a file in the app folder), then re-checks that both rules exist.
- **Launchers:** `batch\5-Start-Hidden.bat` / `start-hidden.vbs` (`fast` skips the build, `noopen` skips the browser), `4-Start-Production.bat` (visible window), `6-Stop-Hidden.bat` (`stop-server.ps1`, which waits for the ports the old server used). Logs: `data\logs\server-<date>.log`.
- **Env for testing:** `HOST` (bind address, default `0.0.0.0`), `MDNS_PORT` (any value other than 5353 = loopback-only test mode, no multicast).
- Why this design: `docs/adr/0010-local-install-and-address.md`.

---

# On a NAS with Docker

## The big picture
**One machine (your NAS) runs the app and holds all the data. Every shop PC just opens a web browser to it.** Nothing is installed on the other PCs — they only need a bookmark. This is what lets everyone share the same job board and pricing.

---

## What you need
- A NAS that can run Docker:
  - **Synology** → "Container Manager" (DSM 7.2+) or the older "Docker" package
  - **QNAP** → "Container Station"
- This project folder, copied onto the NAS.
- About 10 minutes.

## Good things already set up for you
- Runs on **port 3000** (the image sets `PORT=3000`; the friendly `.local` name is for the Windows PC install, not Docker).
- The database is one file at `/app/data/dp-erp.db`. You map `/app/data` to a NAS folder so it's permanent and backed up.
- On its **first start it builds the database and loads your price list automatically** — no fake sample jobs. Step 5 turns it into the labeled **production** database with your admin account.
- **Backs itself up every night at 2 AM** into `/app/data/backups`, checks each copy, keeps 14 days + 8 weeks (`docs/BACKUP.md`).
- Auto-restarts if the NAS reboots or loses power.

---

## Step 1 — Make a home folder on the NAS
Inside a shared folder that already backs up to the cloud, create a folder for the app, e.g.:

```
Backup / dp-erp /
```

Copy the whole project into it. The database will be created in a `data` subfolder here, so **backing up this folder backs up everything**.

## Step 2 — Start the app (pick the option that fits your NAS)

### Option A · Build right on the NAS (fewest steps; best if your NAS has 2 GB RAM or more)
1. **Container Manager → Project → Create.**
2. Point it at the `dp-erp` folder from Step 1 (it will find the included `docker-compose.yml`).
3. Click through to create and run it. The first build takes a few minutes while it downloads and assembles everything.

### Option B · Build on your PC, then import (best for a small / low-memory NAS)
On your PC (needs Docker Desktop installed):

```
docker build -t dp-erp .
docker save dp-erp -o dp-erp.tar
```

Copy `dp-erp.tar` to the NAS, then in **Container Manager → Image → Add → Add From File**, select it. Then create a container from that image with:
- **Port:** host `3000` → container `3000`
- **Volume:** your `dp-erp/data` folder → `/app/data`
- **Enable auto-restart** (so it comes back after a reboot).

## Step 3 — Give the NAS a fixed address
So the bookmark never breaks, reserve a permanent local IP for the NAS (in your router's DHCP settings, or the NAS network settings). Write it down — for example `192.168.1.50`.

## Step 4 — Open it on each shop PC
On every PC, open a browser and go to:

```
http://192.168.1.50:3000
```

(use your NAS's actual address). Bookmark it, or set it as the browser's homepage. **That is the entire setup for the other PCs.**

## Step 5 — Set up the real (production) database
Follow **`docs/PRODUCTION-SETUP.md`**: one command in the container's terminal
(`npm run db:init-prod`) creates your admin account and labels the database as production.
Don't fill in the app's own first-run "create admin" screen instead — then the database stays unlabeled.
After that:
1. Sign in. There must be **no DEMO DATA strip** at the top.
2. Add an account for each person (**Settings → Accounts**).
3. Glance at **Materials** to confirm your price list looks right.

---

## Backups
Your entire business data is the `data` folder from Step 1. The app makes a **checked backup every night at 2 AM** into `data/backups/` (one complete file per night; 14 days + 8 weeks kept), and because `data` sits in your cloud-backed-up share, those go offsite too.
- Make sure the NAS cloud backup includes `data/backups` and runs **after 2 AM**.
- Set your time zone in `docker-compose.yml` (`TZ:` line) so 2 AM is shop time.
- Restoring, the daily check, the monthly restore test and what to do about a corrupt database: **`docs/BACKUP.md`**.
- Don't rely on the cloud's copy of the live `dp-erp.db` / `-wal` / `-shm` files — they can be caught mid-sale. The files in `data/backups` are the ones to restore from.

## Updating to a new version later
First take a backup by hand (container terminal: `npm run db:backup`, see `docs/BACKUP.md`). Then rebuild (Option A) or re-import (Option B) the image and recreate the container. Your `data` folder stays exactly where it is, so **no data is lost** — you just get the new features. The app upgrades the database itself on start. If a red strip ever says "The server is out of date", the page is newer than the running container: recreate/restart the container so it runs the new image. (On a Windows PC, `batch\5-Start-Hidden.bat` and `4-Start-Production.bat` now stop any old server first and start a fresh one - "Start" means "restart".)

## If something goes wrong
- **A PC can't load the page:** check it's on the shop network and the address/port are right; confirm the container is running in Container Manager.
- **"Unreachable — check the server PC/NAS" inside the app:** the container stopped — start it again in Container Manager.
- **Wifi is flaky:** that's fine for the PCs (the app sends tiny amounts of data), but keep the **NAS wired** to the network.
