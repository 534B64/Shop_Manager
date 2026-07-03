# Deploying Decals Plus Shop Manager on your NAS

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
- Runs on **port 3000**.
- The database is one file at `/app/data/dp-erp.db`. You map `/app/data` to a NAS folder so it's permanent and backed up.
- On its **first start it builds the database and loads your price list automatically** — no extra setup, and no fake sample jobs.
- Auto-restarts if the NAS reboots or loses power.
- Default admin password is `admin` — change it after first login.

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

## Step 5 — First-time setup inside the app
1. Open **Settings** and change the admin password from `admin`.
2. Add an account for each person (**Settings → Accounts**).
3. Glance at **Materials** to confirm your price list looks right.

---

## Backups
Your entire business data is the `data` folder from Step 1. Because it sits in your cloud-backed-up share, it's already covered. Once in a while, confirm those files show up in your backups — there will be three: `dp-erp.db`, `dp-erp.db-wal`, and `dp-erp.db-shm`. Backing up the whole `data` folder captures all of them.

## Updating to a new version later
Rebuild (Option A) or re-import (Option B) the image and recreate the container. Your `data` folder stays exactly where it is, so **no data is lost** — you just get the new features.

## If something goes wrong
- **A PC can't load the page:** check it's on the shop network and the address/port are right; confirm the container is running in Container Manager.
- **"Unreachable — check the server PC/NAS" inside the app:** the container stopped — start it again in Container Manager.
- **Wifi is flaky:** that's fine for the PCs (the app sends tiny amounts of data), but keep the **NAS wired** to the network.
