# Decals Plus — Business Context & Challenges

## What Decals Plus Does

Decals Plus is a small custom graphics shop (1–5 people, everyone wears all hats) producing:

- **Custom decals and cut vinyl** — made to order, quoted per job
- **Signs and large format** — banners, vehicle graphics, and similar
- **Custom heat-pressed apparel** — t-shirts are the only stocked blank; most other fabrics are customer-supplied or sourced outside per job
- **Magnet plates**
- **Retail/stock items** sold over the counter

## How the Shop Runs Today

Design work happens in **SignLab**. Files live on a **local NAS** with automated **cloud backup**. Everything operational is analog: deals are written **pen-and-paper in a notebook**, and pricing is **tribal knowledge / best guess** held in the owner's head. The owner's wife is a **CPA**, so the books are well kept — the gap is operational, not financial.

## The Challenges

1. **Pricing lives in one person's head.** Quotes are inconsistent and the business can't delegate quoting. This is the #1 problem: *v1 succeeds when anyone in the shop can quote a job consistently.*
2. **Job tracking is a notebook.** No shared view of what's in production, what's due, or what's been picked up. Jobs can fall through cracks.
3. **Inventory is guesswork.** Vinyl rolls, shirt blanks, magnet stock — no counts, no reorder signals, no cycle counting.
4. **Unreliable wifi.** The shop's wifi is sketchy, so the system must be **self-hosted on the LAN** (NAS/local server, wired) and tolerant of flaky client connections.
5. **Reporting needs are undefined.** The CPA's requirements haven't been gathered yet — a conversation is pending. CSV export of sales/payments is the safe baseline until then.

## What the ERP/POS Must Be

A **self-hosted LAN web app** used from multiple shop PCs. Pillars:

- **Quoting/estimator**: manual price entry always allowed, plus an advisory estimator driven by dimensions, a complexity scale, and a material picker. Materials and their costs are admin-configurable.
- **Order tracking**: most jobs follow one simple path; some need a fuller flow (design/proof step). Statuses must flex per job type without bloat.
- **Inventory**: simple unit counts with low-stock thresholds, cycle counts, and cycle-count scheduling. Per-job material consumption is explicitly out of scope for now.
- **POS/payments**: record-only (amount, method, balance due). No card processing integration.
- **Clean aesthetic**: easier to read than a typical ERP, with light/dark/minimal theme options — but dense enough to be meaningful to a small business.
