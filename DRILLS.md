# The Three Drills — prove the app before trusting it

These are the three real-world checks that no amount of code can substitute
for. They've been open since Phase 0/7 and they are the biggest unproven bets
under the whole app. Each one is an afternoon or less. Do them in order —
each later drill assumes the earlier one worked.

Print this page and check boxes with a pen. When all three pass, the app has
earned the notebook's job.

---

## Drill 1 — Deploy to the NAS and reach it over real shop wifi

**What it proves:** the whole self-hosted-LAN architecture actually works in
your building, on your hardware, over your wifi.

Follow `DEPLOY.md` for the container setup, then:

- [ ] Container is running on the NAS and survives a NAS reboot (restart it
      once on purpose).
- [ ] The NAS has a **fixed IP** (reserved in the router), so the bookmark
      never breaks.
- [ ] Open the app from **PC #1 over wifi** — sign in, load the Dashboard,
      Orders, and Inventory pages.
- [ ] Open the app from **PC #2 at the same time** — make a change on one PC
      (e.g. adjust an inventory count) and confirm the other PC sees it after
      a refresh.
- [ ] Pull the wifi mid-save once (airplane-mode a laptop while saving a
      quote): the app should retry or tell you it's safe to retry — no
      duplicate job, no lost draft.
- [ ] Change the admin password off the default `admin` (Settings → admin).

**Record:** the NAS IP/bookmark URL, and anything that felt slow or flaky.

---

## Drill 2 — Backup and restore (the one nobody does until it's too late)

**What it proves:** the database file is really inside the NAS → cloud backup
pipeline, and a backup can actually be turned back into a working app. Until
a restore has been done once, the backup is an assumption, not a recovery
plan.

- [ ] Find the live data folder on the NAS (the folder mapped to `/app/data`).
      Confirm it contains `dp-erp.db` — and possibly `dp-erp.db-wal` /
      `dp-erp.db-shm` (normal companions; back up all three).
- [ ] Confirm that folder is covered by the NAS backup job / cloud sync —
      look at the backup tool's file list, don't assume.
- [ ] Check the cloud side: can you see a recent copy of `dp-erp.db` there,
      with a timestamp from the last day or two?
- [ ] **Restore drill:** copy the backed-up `dp-erp.db` (+ wal/shm if present)
      into a fresh folder, point a scratch container at it (same
      `docker-compose.yml`, different folder + port), start it, and open it in
      a browser.
- [ ] In the scratch copy: today's jobs are there, payments are there, an
      inventory count matches reality.
- [ ] Delete the scratch container when done, so nobody ever enters real data
      into it by mistake.

**Record:** the date of the drill and how old the backup copy was. Repeat
once or twice a year, or after any change to the backup setup.

---

## Drill 3 — The quoting trial (the actual v1 win condition)

**What it proves:** *anyone in the shop can quote a job consistently* — not
just the owner. This is the whole reason the app exists.

Setup: pick a helper (not the owner), and ~3 real jobs that walk in or came
in recently. The owner quotes them the old way (notebook/head) **without
saying the number out loud**; the helper quotes them in the app at the same
time.

For each of the 3 jobs:

- [ ] Job 1 — helper's app quote: $______ · owner's number: $______ ·
      time taken: ______ min
- [ ] Job 2 — helper's app quote: $______ · owner's number: $______ ·
      time taken: ______ min
- [ ] Job 3 — helper's app quote: $______ · owner's number: $______ ·
      time taken: ______ min

Then answer honestly:

- [ ] Were the app quotes within a range the owner would have accepted?
      (They don't need to match to the dollar — the estimator is advisory.)
- [ ] Was the app **faster or at least no slower** than the notebook?
- [ ] Where did the helper get stuck? (Write every hesitation down — each one
      is a to-do, not a training problem.)
- [ ] Did the helper trust the suggested price, or override it? If they
      overrode it, why?

**Record:** the friction list. That list drives the next round of work —
it outranks every planned feature.

---

## When all three pass

Update `TASKS.md` (Phase 0 deploy item, Phase 7 milestones, Phase 5 backup
item) and start onboarding the rest of the crew. If any drill fails, that
failure is automatically the top of the backlog — see `CLAUDE.md`'s prime
directive.
