import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { materials } from './materials.js';
import { users } from './users.js';

// ---- Suppliers (inventory management pass, 2026-07-07) ----
// Replaces the free-text `vendor` strings as the source of truth. leadTimeDays
// feeds the reorder-point suggestion (avg daily use × lead time + buffer).
// Migration 0012 backfilled one supplier per distinct vendor string; the old
// vendor/default_vendor text columns remain in the DB for history but the UI
// no longer writes them.
export const suppliers = sqliteTable('suppliers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  leadTimeDays: integer('lead_time_days').notNull().default(7),
  contact: text('contact'), // phone / email / rep — free text, one line
  notes: text('notes'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  // Archive, never delete (ADR 0005): hidden from lists/pickers, kept for history.
  archivedAt: text('archived_at'),
  archivedBy: integer('archived_by').references(() => users.id),
});

// ---- Inventory taxonomy (Phase 10, Slice 2) ----
// Smart categories are ORTHOGONAL to the roll-SKU/estimator path: they never
// touch material_colors, nominalWidthIn, or the stock-check. A category is a
// new organizational layer that sits on top of every inventory item (vinyl
// rolls included) purely for browsing/admin defaults — it has no pricing
// effect and the estimator does not read it.
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  defaultUnit: text('default_unit'),
  tracksColor: integer('tracks_color', { mode: 'boolean' }).notNull().default(false),
  defaultVendor: text('default_vendor'), // legacy free text — superseded by defaultSupplierId
  defaultSupplierId: integer('default_supplier_id').references(() => suppliers.id),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  // Archive, never delete (ADR 0005): hidden from lists/pickers, kept for history.
  archivedAt: text('archived_at'),
  archivedBy: integer('archived_by').references(() => users.id),
});

// Admin-managed size list per category (e.g. S/M/L/XL for apparel blanks, or
// 12in/24in for a non-roll material). Distinct from ROLL_SIZES / nominalWidthIn.
export const categorySizes = sqliteTable('category_sizes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  label: text('label').notNull(),
  sort: integer('sort').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  // Archive, never delete (ADR 0005): hidden from lists/pickers, kept for history.
  archivedAt: text('archived_at'),
  archivedBy: integer('archived_by').references(() => users.id),
});

// Custom fields per category (Pass 2 UI — table created now so the schema is
// stable). type is a free string ('text' | 'number' | 'select', etc.);
// options holds JSON for select-type fields.
export const categoryFields = sqliteTable('category_fields', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  options: text('options'),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const inventoryItems = sqliteTable('inventory_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // false = `name` is generated from color/category/size (shared/itemName.ts)
  // and kept in sync when those change; true = the owner typed it. Migration
  // 0019 backfilled existing rows as custom.
  nameIsCustom: integer('name_is_custom', { mode: 'boolean' }).notNull().default(true),
  // Total on-hand across locations, in count units — a CACHE of the ledger
  // sum (Phase 2, ADR 0006). The AFTER INSERT trigger on
  // inventory_adjustments maintains it; a guard trigger rejects any other
  // write. App code never sets it — post a transaction instead.
  count: integer('count').notNull().default(0),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(0),
  vendor: text('vendor'),
  lastCostCents: integer('last_cost_cents'),
  // Roll-SKU fields (Phase 8). When all three are set, this item is a vinyl roll
  // tracked by material + color + nominal width (e.g. `651 · Red · 24in`). The
  // estimator's advisory stock CHECK reads these; the weekly cycle count (which
  // already operates on inventory_items) keeps the counts current. Null on
  // ordinary stock items. This is a lookup, never per-job consumption.
  materialId: integer('material_id').references(() => materials.id),
  color: text('color'),
  nominalWidthIn: integer('nominal_width_in'),
  // ---- Inventory taxonomy (Phase 10, Slice 2). ORTHOGONAL to the roll-SKU /
  // estimator path above — categories are a new organizational layer that sits
  // on EVERY inventory item (roll SKUs included) and never touches
  // material_colors, nominalWidthIn, or the stock-check. categoryId is the
  // smart category this item belongs to (vinyl, blanks, hardware, etc.);
  // sizeText/custom/orderNote are free-form per-item taxonomy fields that work
  // for non-roll items too (e.g. a t-shirt blank's size "L", or a reorder note).
  categoryId: integer('category_id').references(() => categories.id),
  sizeText: text('size_text'),
  custom: text('custom'),
  orderNote: text('order_note'),
  // ---- Inventory management pass (2026-07-07) ----
  // Preferred supplier (replaces free-text vendor going forward).
  supplierId: integer('supplier_id').references(() => suppliers.id),
  // Unit of measure: how it's bought vs. how it's counted, with a conversion
  // factor between them (count units per ONE purchase unit). Most items are
  // 1:1 ('each'/'each'); roll SKUs are 'roll'/'roll' by decision (whole rolls,
  // never partial-roll footage — see CLAUDE.md). `count` is ALWAYS count units.
  purchaseUnit: text('purchase_unit'),
  countUnit: text('count_unit'),
  purchaseToCountFactor: real('purchase_to_count_factor').notNull().default(1),
  // Min/Max reorder logic. Min stays `lowStockThreshold` (every existing
  // consumer — dashboard, LOW chips, reorder report — already reads it).
  // Max is the reorder-up-to quantity in count units.
  reorderMaxQty: integer('reorder_max_qty'),
  // Rolling average daily usage in count units, recomputed when a cycle-count
  // session closes: (baseline count + receipts since − new count) / days.
  avgDailyUse: real('avg_daily_use'),
  // Moving weighted-average cost per COUNT unit (Phase 2, ADR 0006). Only a
  // receipt with a cost moves it; every other transaction is stamped with it.
  avgCostCents: integer('avg_cost_cents').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

// ---- Locations (Phase 2, ADR 0006) ----
// Where stock sits. Migration 0015 seeds id 1 "Shop" (DEFAULT_LOCATION_ID) and
// put every existing count there. Archive, never delete.
export const locations = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  archivedAt: text('archived_at'),
  archivedBy: integer('archived_by').references(() => users.id),
});

// On-hand per item per location — maintained ONLY by the ledger trigger; a
// guard trigger rejects any value that isn't the per-location ledger sum.
export const inventoryBalances = sqliteTable('inventory_balances', {
  itemId: integer('item_id').notNull().references(() => inventoryItems.id),
  locationId: integer('location_id').notNull().references(() => locations.id),
  onHand: integer('on_hand').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.itemId, t.locationId] }),
  locationIdx: index('inventory_balances_location_idx').on(t.locationId),
}));

// The inventory transaction ledger (Phase 2, ADR 0006) — the table keeps its
// historical name; the domain term is "inventory transaction". Append-only
// (0014 triggers). Every on-hand change is one row here; the AFTER INSERT
// trigger applies `delta` to inventory_balances and inventory_items.count.
// Write only through postTransaction() in server/modules/inventory/service.ts.
export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id),
  // Signed quantity in COUNT units.
  delta: integer('delta').notNull(),
  // See TXN_TYPES in shared/domain.ts.
  txnType: text('txn_type').notNull().default('adjustment'),
  // Nullable in the DB only because SQLite can't ADD a REFERENCES column with
  // a default; a BEFORE INSERT trigger rejects NULL, so it's notNull here.
  locationId: integer('location_id').notNull().references(() => locations.id),
  // See ADJUST_REASONS in shared/domain.ts — extended 2026-07-07 with 'sold'
  // (counter-sale deduction) and the cycle-count variance reason codes.
  // Required (a real code) for adjustment / count / production.
  reason: text('reason').notNull(),
  note: text('note'), // discrepancy explanation
  createdBy: text('created_by'), // display name, kept for history
  userId: integer('user_id').references(() => users.id), // null = system / migration
  // Cost per COUNT unit at the time: the receipt's cost on receipts, the
  // item's average cost on everything else.
  unitCostCents: integer('unit_cost_cents'),
  // Receiving: cost paid per PURCHASE unit (as entered) — the per-receipt
  // history behind the cost-trend view. supplierId records who it actually
  // came from (may differ from the item's preferred supplier).
  purchaseUnitCostCents: integer('purchase_unit_cost_cents'),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  // What caused it: 'receipt' | 'job' | 'cycle_count' | 'transfer' | 'manual'
  // | 'migration' (+ id; a transfer's two rows share one id).
  sourceType: text('source_type').notNull().default('manual'),
  sourceId: text('source_id'),
  // Set on rows posted by a count session — ties the ledger row to the session.
  cycleCountId: integer('cycle_count_id').references(() => cycleCounts.id),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({
  itemCreatedIdx: index('inventory_adjustments_item_created_idx').on(t.itemId, t.createdAt),
  createdAtIdx: index('inventory_adjustments_created_at_idx').on(t.createdAt),
  itemIdIdx: index('inventory_adjustments_item_id_idx').on(t.itemId, t.id),
  itemLocDeltaIdx: index('inventory_adjustments_item_loc_delta_idx').on(t.itemId, t.locationId, t.delta),
}));

export const cycleCounts = sqliteTable('cycle_counts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scheduledFor: text('scheduled_for').notNull(), // ISO date
  completedAt: text('completed_at'), // when it was POSTED (Phase 2)
  completedBy: text('completed_by'), // who walked the count (v2, 2026-07-07)
  notes: text('notes'),
  // Approval flow (Phase 2, ADR 0006): counting → submitted → posted. A
  // manager can send a submitted count back to counting; `submission` counts
  // the rounds so the posted round's lines are the ones that count.
  status: text('status').notNull().default('counting'),
  submission: integer('submission').notNull().default(0),
  submittedAt: text('submitted_at'),
  submittedBy: text('submitted_by'),
  postedBy: text('posted_by'), // the approving manager
  nextScheduledFor: text('next_scheduled_for'), // the counter's pick for the next session, used at posting
});

// One row per item actually counted in a session — the immutable snapshot
// behind variance review and the per-item variance-trend view. systemCount is
// what the app believed when the count was SUBMITTED; countedQty is what was
// on the shelf; posting books counted − systemCount (not counted − current).
// unitCostCents is the per-COUNT-unit cost snapshot used for the dollar-impact
// sort (average cost at the time; lastCost ÷ factor before Phase 2).
// reasonCode is required (server-enforced) when the variance beat the
// configured threshold; below it the drift books as plain 'cycle_count'.
export const cycleCountLines = sqliteTable('cycle_count_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cycleCountId: integer('cycle_count_id').notNull().references(() => cycleCounts.id),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id),
  systemCount: integer('system_count').notNull(),
  countedQty: integer('counted_qty').notNull(),
  unitCostCents: integer('unit_cost_cents'),
  reasonCode: text('reason_code'),
  note: text('note'),
  // Which submission round of the session this line belongs to (a sent-back
  // round's lines stay — the table is append-only).
  submission: integer('submission').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({ countIdx: index('cycle_count_lines_count_idx').on(t.cycleCountId) }));
