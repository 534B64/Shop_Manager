import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

const nowIso = () => new Date().toISOString();

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  // Customer level 0–3 — admin assigned; levels 1+ get an admin-set discount %.
  level: integer('level').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

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

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Client-generated UUID making job creation idempotent over sketchy wifi.
  clientRef: text('client_ref').unique(),
  customerId: integer('customer_id').references(() => customers.id),
  // Auto-generated order key (DP-YYMMDD-###) — also the SignLab filename prefix.
  po: text('po').unique(),
  type: text('type').notNull(), // decal | sign | apparel | magnet | retail
  title: text('title').notNull(),
  tags: text('tags'), // comma-separated, searchable
  fileRef: text('file_ref'), // NAS path or filename of the design file
  createdBy: text('created_by'), // who placed the order (sign-in name)
  status: text('status').notNull().default('order'),
  useProofFlow: integer('use_proof_flow', { mode: 'boolean' }).notNull().default(false),
  dueDate: text('due_date'), // ISO 8601 date
  // --- Estimator inputs, kept so a quote shows how it was derived ---
  quantity: integer('quantity').notNull().default(1),
  widthIn: real('width_in'),
  heightIn: real('height_in'),
  complexity: integer('complexity'), // RETIRED 2026-07-02 (surcharge removed) — column kept for historical jobs, no longer written
  rollWidthIn: real('roll_width_in'), // vinyl roll width used (advisory)
  // Color multiplier applied to the MAIN line only (1 | 2 | 3). Per-line so a
  // 2/3-color tag on one item never inflates the rest of the ticket.
  mainColorMult: integer('main_color_mult').notNull().default(1),
  materialId: integer('material_id').references(() => materials.id),
  // Snapshot of material cost at quote time — cost changes never rewrite history.
  materialCostSnapshotCents: integer('material_cost_snapshot_cents'),
  // --- Estimator output and the human decision are both kept. Integer cents. ---
  suggestedPriceCents: integer('suggested_price_cents'),
  finalPriceCents: integer('final_price_cents'),
  taxable: integer('taxable', { mode: 'boolean' }).notNull().default(true),
  discountPct: real('discount_pct'), // customer-level discount applied (after tax)
  // Grand total actually charged: primary + items, tax and discount applied.
  totalCents: integer('total_cents'),
  // Soft delete (admin/user password required). Money rows stay for the books.
  deletedAt: text('deleted_at'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Client-generated UUID — payment recording is retry-safe too.
  clientRef: text('client_ref').unique(),
  jobId: integer('job_id').notNull().references(() => jobs.id),
  amountCents: integer('amount_cents').notNull(),
  method: text('method').notNull(), // cash | check | card | credit | other
  kind: text('kind').notNull().default('payment'), // payment | refund
  // Mistakes are voided, never deleted — the books stay auditable.
  voidedAt: text('voided_at'),
  voidReason: text('void_reason'),
  createdBy: text('created_by'),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

export const customerCredits = sqliteTable('customer_credits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  deltaCents: integer('delta_cents').notNull(), // + add credit, − apply credit
  note: text('note'),
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

// Admin-managed color list for a roll material (usesRoll). A color here is a
// material *variant* (Red 651 vs Blue 651) — it selects which roll/inventory to
// check and does NOT change price (a yard of 651 costs the same in any color).
export const materialColors = sqliteTable('material_colors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  materialId: integer('material_id').notNull().references(() => materials.id),
  name: text('name').notNull(),
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

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  // Plain text on purpose: LAN-only shop tool. Gates actions, not secrets.
  password: text('password'),
  // Per-account preferences: theme, custom accent, dashboard card visibility.
  prefs: text('prefs'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

// Extra line items on a job (beyond the primary estimated item).
export const jobItems = sqliteTable('job_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  materialId: integer('material_id').references(() => materials.id),
  widthIn: real('width_in'),
  heightIn: real('height_in'),
  complexity: integer('complexity'), // RETIRED 2026-07-02 (surcharge removed) — kept for historical items, no longer written
  rollWidthIn: real('roll_width_in'), // per-item vinyl roll width (advisory)
  colorMult: integer('color_mult').notNull().default(1), // 1 | 2 | 3 for THIS item only
  fileRef: text('file_ref'),
  qty: integer('qty').notNull().default(1),
  priceCents: integer('price_cents').notNull(),
});
