# Shop Manager — Roadmap & Work-Session Brief

Planning doc for the next round of work. Captures everything discussed in the
review session: the new inventory-aware quoting feature, a UX/UI pass, the
file-reference approach, future card processing, and the hardening backlog.
Companion to `TASKS.md` (where these become checklist phases) and `CLAUDE.md`
(where the scope rules live). Nothing here changes the prime directive —
**anyone in the shop can quote a job consistently** — these items serve it.

Suggested order of attack: **Hardening → Inventory-aware quoting → UX pass.**
Prove the deployment and lock in trust/safety first, then add the feature that
makes quotes smarter, then make the whole thing feel good. Card processing
stays post-rollout.

**Status (2026-06-16):** Hardening (code), Inventory-aware quoting (§A), and the
UX foundation + file-by-PO (§B/§C) all shipped. App renamed **DP ERP → Shop
Manager** (v0.10.0). Active work is **Phase 10 — Inventory corrections**: Slice 1
(organization + advanced search/filter) and Slice 2 Pass 1 (admin taxonomy —
categories/units/sizes + smart categories, migration `0010`) are done & verified,
plus a Phase 10.5 live-feedback batch (removable customers/categories/orders,
search across admin lists, Inventory Settings moved into Settings, theme rework:
Light/Dark accent picker, Minimal→High Contrast, Custom reserved for a future
view).

**Update (2026-06-30):** A full codebase critique + grilling session reordered
what's next. **Slice 2 Pass 2 (custom fields per category) is on hold** —
before it, do: (1) stock-check on additional quote line items, and (2) roll SKU
data-integrity (DB uniqueness + color validation) — both promoted ahead of the
restock-spreadsheet seed so bad/duplicate data isn't loaded first. See
`TASKS.md` Phase 11 for the full triage list (doc fixes, dead-code removal,
file-upload reversal, cycle-count auto-reschedule, an admin-override audit
trail, and inventory integration-test coverage). See `HANDOFF.md` for full
current-state context. See `TASKS.md` for the live checklist.

**Update (2026-07-09):** Phase 12 — full inventory management — shipped in one
pass (suppliers + lead time, UOM, blind cycle-count v2 with variance reason
codes, Min/Max + AUTO reorder point, receiving with per-receipt cost history,
counter-sale deduction on Quick Order, valuation/cost/variance reports).
Migration `0012`, 147 tests. Weekly-count-as-reconciler principle preserved —
still no production-consumption tracking. The drills remain the critical path;
the roll-SKU seed should now also load supplier/UOM. See `TASKS.md` Phase 12
and the devlog entry.

**Update (2026-07-01):** The triage batch shipped. Done: server-side
quote-math verification (the critique's top finding — the server now
recomputes and stores suggested + grand totals, warning on stale-client
mismatches), multi-line stock-check (batched, shared request logic), roll SKU
integrity (DB unique index via migration `0011` + color-list validation),
cycle-count auto-reschedule (+7 days), attributable unpaid-pickup overrides,
file-upload endpoint removal (`fileRef` only), and inventory-route integration
tests (suite: 119 passing). `DRILLS.md` added — printable checklists for the
three §E drills, which are now the critical path. **Next:** run the drills
(Josiah, physical), seed inventory from `Inventory-Restock-Review.xlsx` (now
unblocked), then decide Slice 2 Pass 2 vs. reskin.

---

## A. Inventory-aware quoting (vinyl color + roll size + stock check)

**Goal:** when a quote selects a vinyl, the estimator tells the salesperson
whether that exact color and roll size is actually on the shelf — before they
promise it to a customer.

**Hard principle to preserve:** this is an **advisory stock *check*, not stock
*consumption*.** It is a "do we have it right now?" lookup (count > 0). It never
deducts material per job, never blocks a quote, and never overrides the manual
price. Per-job consumption stays out of scope (see `CLAUDE.md`). The estimator
remains advisory.

### A.1 Color is a material variant, not the color-count price tag
Two different "colors" exist and must stay separate:

- The existing **"2 color / 3 color" tag** is a *price multiplier* (how many
  colors are in the artwork). Unchanged.
- The **new color option** (Red 651 vs. Blue 651) is a *material variant*. It
  determines which roll/inventory to check and **does not change price** — a
  yard of 651 costs the same in any color.

Keeping these separate means the pricing engine (`shared/pricing.ts`) is
untouched; this feature is purely an inventory-awareness layer.

### A.2 Data model
- **Material colors.** A roll-type material (`usesRoll = true`) gets an
  admin-maintained list of colors, edited on the Materials page. Selecting that
  material in a quote reveals a color dropdown. Non-roll materials show nothing.
- **Inventory becomes SKU-level for roll materials.** A roll inventory item is
  identified by **material + color + nominal roll width** — e.g.
  `651 Vinyl · Red · 24in`. Each SKU carries its own count.
  - *Decision (confirmed):* track at **color *and* size** granularity. Yes, the
    initial setup is tedious (one row per color/width actually stocked), but
    stock checks are already weekly, so the existing **cycle-count workflow**
    keeps the counts current after the one-time load.
  - Only stock the SKUs the shop actually carries — don't pre-create all 60
    colors × 4 widths. Add a SKU when a roll first comes in.

### A.3 Quote-time cross-reference logic
Inputs: selected material, selected color, and the auto-picked least-waste roll
width (from the existing `shared/rolls.ts` logic). The check looks across **all
in-stock widths of that color**, since a wider roll can still cut the part
(with more waste). Three states:

| State | Condition | Signal |
|---|---|---|
| In stock | The optimal (least-waste) width of that color has count > 0 | No warning |
| Suboptimal | Optimal width is out, but another fitting width of that color is in stock | **Yellow** note: "optimal {size}″ out of stock — using {in-stock size}″". The in-stock width is auto-selected and **highlighted in yellow** in the roll picker. |
| Out of stock | No fitting width of that color has any stock | **Red** warning at the bottom: "{material} {color} is out of stock — verify before promising." |

- All signals are advisory; saving the quote/order is never blocked.
- Roll *width* remains a waste estimate; color+width *count* is the stock key.

### A.4 Opt-in & false-alarm guard
- Only materials that have colors set up and stocked get checked. A material
  with no color/inventory data shows **nothing** — never a false red alarm.
- Light it up for the two or three high-volume vinyls first; expand later.

### A.5 Build checklist (rough)
1. Schema: add material colors (list per material) and link roll inventory items
   to `materialId + color + nominalWidthIn`. Migration checked in; `db:migrate`
   clean on a fresh file.
2. Materials admin: manage the color list per roll material.
3. Inventory: create/track roll SKUs by color + width; surface them in cycle
   counts so the weekly count maintains them.
4. Quotes page: color dropdown on roll materials; cross-reference logic; yellow
   suboptimal note + highlighted in-stock width; red out-of-stock warning.
5. Tests: the three-state availability logic (in stock / suboptimal / out),
   including the "wider roll still fits" case.
6. One-time data load: enter current roll SKUs and counts, then rely on cycle
   counts.

---

## B. UX/UI pass

**Chosen direction: B — dense & professional** (from the three mockups), because
the shop wins or loses on **quoting speed**, and B's tight table rows + keyboard
tab-flow keep a multi-item quote on one screen.

**Refinements to fold in:**
- Borrow **Direction A's restraint and large, confident total** — keep B dense
  but give the grand total real visual weight.
- Reserve **Direction C's warmth** (rounded, friendly, avatar, softer color) for
  *counter-facing* surfaces — Quick Order and the customer-facing printout —
  not the power-user quote screen.

*Shipped (2026-06-16):* Inventory filtering to speed stock checks — a search box
(name/color/vendor) plus filters for kind (rolls vs. other stock), material,
color, and roll size, with a low-stock-only toggle and a live "X of Y" count.
Roll SKUs are tagged in the list. Helps locate a specific color/width fast during
cycle counts and quote-time stock lookups.

**Do it as a design system, not a per-page reskin.** Define the shared pieces
once so every screen inherits the look (this is the "architecture/organization"
part):
- Tokens already exist (CSS variables + light/dark/minimal themes) — build on
  them, don't replace them.
- Standardize: buttons, inputs/selects, tables, cards, spacing scale, and the
  accent color. Then apply across Dashboard, Quotes, Orders, Quick Order,
  Payments, Customers, Inventory, Materials, Settings.
- Keep touch-friendly targets at the counter and keyboard-fast entry for
  quoting — both are existing requirements.

*Mockups from the session are reference only; reproduce later if needed.*

---

## C. File reference by PO name (replaces uploads)

Design-file uploads were removed in v0.9.0 — correct call. Files already live in
the NAS folder and staff are used to saving them there. So the app shouldn't ask
anyone to upload; it should make it trivial to **name the file correctly**:

- Show the auto-generated **PO with a one-tap "copy" button** on the job/quote
  screen; the staffer pastes it as the SignLab filename.
- Optionally store/display the expected **filename or NAS path** as a text
  reference on the job, so anyone can locate the file later.
- No upload, no storage, less to maintain — and it matches the existing habit.

---

## D-pre. Open question: should "no external SaaS dependencies" ever flex?

Raised 2026-06-30 while discussing cycle-count scheduling (the idea was Google/
Microsoft Calendar sync so a weekly count never gets forgotten). That contradicts
the architecture rule in `CLAUDE.md`. **Deliberately not decided here** — the
in-app auto-reschedule (`TASKS.md` Phase 11) solves the actual forgetting
problem without the dependency, so nothing is blocked on this. But if the
appetite for a real calendar/notification integration exists, that deserves
its own dedicated conversation — what problem it actually solves beyond the
in-app fix, what breaks when the shop's internet (not just wifi) is down, and
whether it's a one-off exception or a rule change — not a decision to make as
a side effect of one feature.

## D. Card processing (post-rollout, future)

Open to integrated payments later (Stripe, Square, Venmo, CashApp). **First task
is not code — find out what the shop swipes today** (likely Square for a shop
this size; confirm). The providers differ a lot, so pick one and match it.
Record-only payments stay the safe fallback. Explicitly deferred until after
rollout; still listed out-of-scope for v1.

---

## E. Hardening backlog (do first)

From the project critique. These protect the v1 win and the data.

1. **Deploy & verify (Phase 0 open item).** Stand the container up on the NAS,
   reserve a fixed IP, open it from two PCs over real shop wifi. Validates the
   whole self-hosted-LAN architecture bet, which is still unproven.
2. **Quoting trial (Phase 1 milestone).** Have a non-owner quote ~3 real jobs
   against the owner's numbers; log time-vs-notebook and friction; tune from
   that. This is the actual v1 win condition.
3. **Backup + restore drill (Phase 5 open item).** Confirm `dp-erp.db`
   (+ `-wal`/`-shm`) lands in the NAS → cloud pipeline, then do one restore to a
   scratch container. The backup is currently an assumption, not a proven
   recovery.
4. **Trust fixes.** Force the admin password off the default `admin` on first
   login; reconcile the tax default (UI field vs. server default); remove the
   legacy `laborFactorPct` surface still accepted by the materials API.
5. **Safety-net tests.** Add integration tests for job creation, status
   transitions, and payment/void/balance math. Today only the pure logic is
   tested; the highest-value flows have no automated coverage.

---

## Sequencing summary

```
1. Hardening (E)            ← prove deploy, lock trust/backups, before adding more
2. Inventory-aware quoting (A)
3. UX/UI pass (B)
   · File-by-PO (C) is small — fold into the UX pass
4. Card processing (D)      ← post-rollout, separate effort
```
