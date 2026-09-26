import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { customers } from './customers.js';
import { materials } from './materials.js';

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
  // Tax rate totalCents was computed with (Phase 3) — the invoice snapshots it.
  taxRatePct: real('tax_rate_pct'),
  // Grand total actually charged: primary + items, tax and discount applied.
  totalCents: integer('total_cents'),
  // Soft delete ("Remove" — manager approval, ADR 0004/0005). Money rows stay for the books.
  deletedAt: text('deleted_at'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({
  createdAtIdx: index('jobs_created_at_idx').on(t.createdAt),
  statusIdx: index('jobs_status_idx').on(t.status),
  customerIdx: index('jobs_customer_idx').on(t.customerId),
}));

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
  // Set when a job edit replaced this line (ADR 0005) — kept for history,
  // ignored by every reader.
  deletedAt: text('deleted_at'),
}, (t) => ({ jobIdx: index('job_items_job_idx').on(t.jobId) }));
