import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';

export const materials = sqliteTable('materials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  unit: text('unit').notNull(), // sqft | each | sheet | linear_ft
  costPerUnitCents: integer('cost_per_unit_cents').notNull(),
  // ---- Price book ----
  // per_inch_max: rate × longest side (in) · per_sqft: rate × w×h/144
  // per_unit: rate per piece (rate2 = top of complexity range) · flat: rate per piece
  // custom: no suggestion (aluminum signs, full-color prints)
  priceMode: text('price_mode').notNull().default('custom'),
  rateCents: integer('rate_cents').notNull().default(0),
  rate2Cents: integer('rate2_cents'), // upper bound for complexity-scaled per_unit
  minQty: integer('min_qty').notNull().default(1),
  // Apply ×2 / ×3 when a '2 color' / '3 color' tag is assigned to a line.
  colorMultiplier: integer('color_multiplier', { mode: 'boolean' }).notNull().default(true),
  // Show the roll-width picker for this material (cal/cast/vinyl only).
  usesRoll: integer('uses_roll', { mode: 'boolean' }).notNull().default(false),
  // Add-on line item (t-shirt blank, squeegee, etc.) — grouped in the item picker.
  isAddon: integer('is_addon', { mode: 'boolean' }).notNull().default(false),
  // Legacy (unused by price book, kept for history):
  laborFactorPct: integer('labor_factor_pct').notNull().default(100),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

// Admin-managed color list for a roll material (usesRoll). A color here is a
// material *variant* (Red 651 vs Blue 651) — it selects which roll/inventory to
// check and does NOT change price (a yard of 651 costs the same in any color).
export const materialColors = sqliteTable('material_colors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  materialId: integer('material_id').notNull().references(() => materials.id),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});
