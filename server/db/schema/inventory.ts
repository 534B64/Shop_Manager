import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
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
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id),
  delta: integer('delta').notNull(),
  // See ADJUST_REASONS in shared/domain.ts — extended 2026-07-07 with 'sold'
  // (counter-sale deduction) and the cycle-count variance reason codes.
  reason: text('reason').notNull(),
  note: text('note'), // discrepancy explanation
  createdBy: text('created_by'),
  // Receiving: cost paid per PURCHASE unit on 'received' rows — the per-receipt
  // cost history behind the cost-trend view (lastCostCents on the item is only
  // the latest). supplierId records who it actually came from (may differ from
  // the item's preferred supplier).
  unitCostCents: integer('unit_cost_cents'),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  // Set when this adjustment was written by a count session closing — ties the
  // ledger row to the session, and excludes it from receipt/usage math.
  cycleCountId: integer('cycle_count_id').references(() => cycleCounts.id),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({
  itemCreatedIdx: index('inventory_adjustments_item_created_idx').on(t.itemId, t.createdAt),
  createdAtIdx: index('inventory_adjustments_created_at_idx').on(t.createdAt),
}));

export const cycleCounts = sqliteTable('cycle_counts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scheduledFor: text('scheduled_for').notNull(), // ISO date
  completedAt: text('completed_at'),
  completedBy: text('completed_by'), // who walked the count (v2, 2026-07-07)
  notes: text('notes'),
});

// One row per item actually counted in a session — the immutable snapshot
// behind variance review and the per-item variance-trend view. systemCount is
// what the app believed at the moment the session closed; countedQty is what
// was on the shelf. unitCostCents is the per-COUNT-unit cost snapshot used for
// the dollar-impact sort (lastCostCents ÷ purchaseToCountFactor at the time).
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
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({ countIdx: index('cycle_count_lines_count_idx').on(t.cycleCountId) }));
