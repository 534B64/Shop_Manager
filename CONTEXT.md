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

## Domain Glossary

Canonical terms, confirmed against the code (2026-07-03). When a word below is
used in code, docs, or conversation, it means exactly this.

### Jobs

- **Job** — the single aggregate for all work sold: a quote and an order are the
  *same record* at different lifecycle statuses, never two entities. Carries the
  estimator inputs it was derived from, and both prices (suggested and final).
  "Removing" an order archives it (see **Archive**). Identified to humans by its
  **PO**.
- **Quote** — a Job whose status is `quote` (proof flow only). Simple jobs skip
  it and are born `acknowledged`.
- **Order** — informal name for a Job past the quote stage. Not a separate table.
- **Line** — one independently-priced unit of a Job: the *main item* (columns on
  the Job itself) plus zero or more *additional items* (`job_items` rows). Each
  line has its own material, dimensions, qty, and color multiplier. When an edit
  replaces a job's lines, the old ones are kept as history, never erased.
- **PO** — auto-generated order key, `MMDDYY + 3-digit daily sequence`. Also the
  SignLab filename convention on the NAS (see File reference).
- **Proof flow** — the optional long lifecycle (`quote → approved → design →
  in production → done → picked up`), enabled per job. The default simple path
  is `acknowledged → in production → done → picked up`.
- **Cost snapshot** — a material's cost copied onto the Job at quote time.
  Editing a material's cost never rewrites history.
- **Price check** — the server's recomputation of a quote's suggested and grand
  totals. A mismatch warns (stale client) but never blocks the save.
- **Client ref** — client-generated UUID making job/payment creation idempotent
  over sketchy wifi; a retry returns the existing row.

### Materials & pricing

- **Material** — an admin-configured thing jobs are priced against (651 vinyl,
  magnet blank, t-shirt). Carries its **price rule**.
- **Price rule / price mode** — how a material suggests a price: `per_inch_max`,
  `per_sqft`, `per_unit`, `flat`, or `custom` (no suggestion).
- **Add-on** — a flat-priced material flagged `isAddon` (t-shirt blank,
  squeegee), grouped separately in the item picker.
- **Roll material** — a material flagged `usesRoll`; shows the roll-width picker
  and carries an admin-managed **color list**.
- **Estimator** — the advisory pricing engine (`shared/pricing.ts`). Suggests,
  never binds; the human-set final price always wins.
- **Color (two meanings — never conflate):**
  1. **Color multiplier** — the `2 color`/`3 color` *price tag* on a single
     line (×2/×3). About artwork complexity, not the vinyl.
  2. **Material color (variant)** — Red 651 vs Blue 651. Selects which roll
     SKU to stock-check. **Never changes price.**

### Inventory

- **Inventory item** — something the shop stocks and counts, with a low-stock
  threshold. No per-job consumption, deliberately.
- **Inventory transaction** — one recorded change to how many of an item are
  on the shelf: a receipt, sale, return, adjustment, transfer, count posting,
  production use, or opening balance. Says who, when, why, and what document
  caused it. Never edited or removed once written.
- **On-hand** — how many of an item the shop has, at one location or in
  total. It is exactly the sum of the item's inventory transactions; nobody
  types it in.
- **Location** — a place stock sits ("Shop" by default). A **transfer** moves
  stock between locations without changing the item's total.
- **Opening balance** — the transaction that starts an item's history: its
  count when first created, or whatever an older record held that its
  history didn't explain.
- **Average cost** — what one count unit of an item has cost the shop, on
  average, across everything received. Each receipt blends in its price;
  when the shelf was empty, the new receipt's price becomes the average.
  Inventory value = on-hand × average cost.
- **Roll SKU** — an inventory item keyed `material + color + nominal width`
  (e.g. `651 · Red · 24in`). Unique per key (DB-enforced); color must be on the
  material's color list.
- **Nominal vs usable width** — usable = nominal − 1.5″ (web/clamp loss).
- **Stock check** — the advisory quote-time lookup: `unknown` (no data — show
  nothing), `in_stock`, `suboptimal` (optimal width out, a wider fitting width
  in), `out_of_stock`. Never blocks, never deducts. *This is the only
  job↔inventory relationship in the system.*
- **Adjustment** — an inventory transaction that corrects on-hand outside of
  receiving, selling, or counting (damage, waste, theft, a data-entry fix).
  Always has a reason code and needs a manager's approval.
- **Cycle count** — the weekly recount session. People count blind, then
  **submit**; the difference from what the system expected is the
  **variance**. A manager **posts** the count (the variances become
  transactions) or sends it back to be recounted. Posting schedules the next
  count (+7 days). Stock that moves between submitting and posting stays
  moved.
- **Category** — inventory taxonomy (browsing/admin defaults only). Orthogonal
  to roll SKUs and the stock check; no pricing effect.

### Money

- **Payment** — money taken from a customer toward a Job, with its tender:
  cash, card, check, store credit, or other. Card is recorded only — the shop
  never keeps card numbers. For cash, what was handed over and the change
  given are recorded too. Money rows are never erased.
- **Refund** — money handed back to a customer, in the same ledger as
  payments. A refund made because of a void or a return points at it.
- **Invoice** — the locked record of a sale: what was sold, at what price,
  with what tax and discount, to whom. Made when a Job is paid in full or
  picked up, or at once for a counter sale. Once a Job has an invoice, its
  prices, tax, discount, customer, and lines can't be changed — a mistake is
  fixed by voiding the invoice or taking a return, never by editing it. An
  invoice is never changed or removed.
- **Invoice number** — the invoice's own number, separate from the PO:
  consecutive with no gaps and never reused (shown as `000001`). A sale that
  fails doesn't use one up.
- **Line tax** — sales tax worked out and kept on each invoice line at the
  moment of sale, with the rate used; the invoice's tax is the sum of its
  lines.
- **Void** — two different things, always say which:
  1. **Payment void** — marking one payment or refund row as entered by
     mistake (reason required). The row stays on the books and stops counting.
  2. **Invoice void** — cancelling a whole sale (manager approval, reason).
     The invoice stays exactly as it was; a separate void record points at it,
     what the customer paid is refunded, and any stock the sale took goes back
     on the shelf. The order is removed, or — when kept — can be corrected and
     invoiced again under a new number.
- **Return** — goods coming back against an invoice (an RMA): which lines and
  how many, never more than were sold minus what already came back. Each
  returned line is marked **restock** (back on the shelf) or not (damaged).
  Its value includes that line's share of tax and discount. The customer gets
  back only what they had overpaid once the return lowers what they owe;
  returns worth more than the shop's threshold need a manager.
- **Price override** — saving a price different from the estimator's
  suggestion. Always allowed (the estimator is advisory), but a manager
  approves it and it is logged.
- **Balance** — derived, never stored: after-tax total − returned goods − live
  payments + live refunds. Overpayment warns but is allowed.
- **Drawer session** — one stretch of the cash drawer's life: opened by
  counting the starting cash (the float), closed by counting it again. All
  cash taken or handed back happens inside an open session; without one the
  shop can't take cash. One drawer is open at a time. Closing needs a manager.
- **Over/short** — at drawer close, the counted cash minus what should be
  there (float + cash taken − cash refunded). Positive is over, negative is
  short.
- **Z-report** — the end-of-day summary a drawer session closes into: totals
  by tender, sales, tax, discounts, invoice voids, returns and refunds, the
  first and last invoice numbers, and expected vs counted cash. Fixed forever
  once the drawer is closed.
- **Credit ledger** — per-customer store credit as signed entries; balance may
  not go negative.

### Customers & access

- **Walk-in** — the one generic customer record Quick Order uses; the sole
  exemption from the email-required rule.
- **Level** — manager-assigned customer tier 0–3; levels 1+ get a discount %.
- **Role** — what an account may do: **cashier** (quotes, orders, payments,
  receiving, counts), **manager** (also approves money/override actions and
  runs inventory setup), **admin** (also pricing, tax, and accounts). Every
  account has exactly one role; the shop must always keep one active admin.
- **Session** — a person's signed-in presence on one PC, started with their
  name + PIN. Everything done in a session is recorded under that person.
  Sessions end on sign-out, after a long idle, or when an admin changes the
  account.
- **Manager approval** — a manager (or admin) entering *their own* name + PIN
  at the moment a sensitive action happens (void, refund, unpaid pickup,
  removing an order, archiving or restoring a customer, store-credit or stock
  corrections, a price override, a return over the refund threshold). A manager
  acting alone approves themselves. Every approval is logged permanently with
  who asked and who approved.

### Records & history

- **Archive** — what "delete" means everywhere in the app: the record is hidden
  from lists and pickers but kept, still shows wherever older records point to
  it, and can be restored. Nothing the shop has entered is ever erased.
- **Audit log** — the permanent, append-only history of every change anyone
  made: who, when, what it looked like before and after, and which manager
  approved it when approval was needed. It can be read and exported, never
  edited.
- **Production data** — the shop's real records: real customers, sales, money
  and stock. There is exactly one production database, started once with a
  single admin and nothing made up.
- **Demo data** — made-up practice records (sample customers, jobs, and
  accounts with well-known PINs) kept apart from production data and always
  marked "DEMO DATA" on screen. Demo data never mixes into production data.
- **Backup** — a checked copy of the whole shop's records as they stood at one
  moment. **Restoring** one puts the shop back to that moment; anything entered
  after it must be re-entered, and the records being replaced are set aside,
  never thrown away.

### Explicit non-concepts

- **Job-material consumption** — does not exist and is out of scope for v1 by
  design. Quoting a job never decrements inventory; the stock check is a
  lookup. If a future phase adds consumption, that is a new decision, not a
  gap.
- **Complexity surcharge** — removed 2026-07-02. DB columns remain for
  historical jobs but are never written.
