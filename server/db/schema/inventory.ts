import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { materials } from './materials.js';

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
  defaultVendor: text('default_vendor'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

// Admin-managed size list per category (e.g. S/M/L/XL for apparel blanks, or
// 12in/24in for a non-roll material). Distinct from ROLL_SIZES / nominalWidthIn.
export const categorySizes = sqliteTable('category_sizes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  label: text('label').notNull(),
  sort: integer('sort').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
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
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(), // received | used | damaged | cycle_count | correction
  note: text('note'), // discrepancy explanation
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const cycleCounts = sqliteTable('cycle_counts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scheduledFor: text('scheduled_for').notNull(), // ISO date
  completedAt: text('completed_at'),
  notes: text('notes'),
});
