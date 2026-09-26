// Phase 3 (ADR 0007): invoices, invoice voids, returns, the number sequence,
// and cash drawer sessions. Mirrors migration 0016 — every table here is
// append-only by trigger except drawer_sessions' one-time close.
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { customers } from './customers.js';
import { jobs } from './jobs.js';
import { users, approvals } from './users.js';
import { inventoryItems } from './inventory.js';

/** Gap-free counters ('invoice'); only ever stepped +1 inside a transaction. */
export const numberSequences = sqliteTable('number_sequences', {
  name: text('name').primaryKey(),
  nextValue: integer('next_value').notNull(),
});

export const drawerSessions = sqliteTable('drawer_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Single-register shop today; the column lets a second register exist later.
  registerId: integer('register_id').notNull().default(1),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  openedAt: text('opened_at').notNull().$defaultFn(nowIso),
  openedBy: integer('opened_by').notNull().references(() => users.id),
  openingFloatCents: integer('opening_float_cents').notNull(),
  openNote: text('open_note'),
  closedAt: text('closed_at'),
  closedBy: integer('closed_by').references(() => users.id),
  expectedCashCents: integer('expected_cash_cents'),
  countedCashCents: integer('counted_cash_cents'),
  overShortCents: integer('over_short_cents'),
  expectedChecksCents: integer('expected_checks_cents'),
  countedChecksCents: integer('counted_checks_cents'),
  checksOverShortCents: integer('checks_over_short_cents'),
  closeNote: text('close_note'),
  zReportJson: text('z_report_json'),
}, (t) => ({
  oneOpen: uniqueIndex('drawer_sessions_one_open').on(t.registerId).where(sql`status = 'open'`),
  openedAtIdx: index('drawer_sessions_opened_at_idx').on(t.openedAt),
}));

export const invoices = sqliteTable('invoices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: integer('number').notNull(), // display zero-padded: 000001
  jobId: integer('job_id').notNull().references(() => jobs.id),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name'),
  jobPo: text('job_po'),
  title: text('title').notNull(),
  source: text('source', { enum: ['job', 'counter_sale'] }).notNull(),
  taxRatePct: real('tax_rate_pct').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  discountPct: real('discount_pct').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  drawerSessionId: integer('drawer_session_id').references(() => drawerSessions.id),
  createdBy: text('created_by'),
  userId: integer('user_id').references(() => users.id),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({
  numberUnique: uniqueIndex('invoices_number_unique').on(t.number),
  createdAtIdx: index('invoices_created_at_idx').on(t.createdAt),
  jobIdx: index('invoices_job_idx').on(t.jobId),
  customerIdx: index('invoices_customer_idx').on(t.customerId),
  drawerIdx: index('invoices_drawer_idx').on(t.drawerSessionId),
}));

export const invoiceLines = sqliteTable('invoice_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  lineNo: integer('line_no').notNull(),
  description: text('description').notNull(),
  detail: text('detail'), // JSON: the job's additional items, for printing
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  suggestedCents: integer('suggested_cents'),
  taxable: integer('taxable', { mode: 'boolean' }).notNull(),
  taxRatePct: real('tax_rate_pct').notNull(),
  taxCents: integer('tax_cents').notNull(),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  inventoryItemId: integer('inventory_item_id').references(() => inventoryItems.id),
  stockQty: integer('stock_qty').notNull().default(0), // count units the sale actually deducted
}, (t) => ({ invoiceIdx: index('invoice_lines_invoice_idx').on(t.invoiceId) }));

export const invoiceVoids = sqliteTable('invoice_voids', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  reason: text('reason').notNull(),
  refundCents: integer('refund_cents').notNull().default(0),
  // What the void cancelled: invoice total/tax minus returns already taken (0017).
  netTotalCents: integer('net_total_cents'),
  netTaxCents: integer('net_tax_cents'),
  jobArchived: integer('job_archived', { mode: 'boolean' }).notNull().default(true),
  approvalId: integer('approval_id').references(() => approvals.id),
  drawerSessionId: integer('drawer_session_id').references(() => drawerSessions.id),
  createdBy: text('created_by'),
  userId: integer('user_id').references(() => users.id),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({
  invoiceUnique: uniqueIndex('invoice_voids_invoice_unique').on(t.invoiceId),
  createdAtIdx: index('invoice_voids_created_at_idx').on(t.createdAt),
  drawerIdx: index('invoice_voids_drawer_idx').on(t.drawerSessionId),
}));

/** Returns (RMAs). SQL table `returns`. */
export const salesReturns = sqliteTable('returns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientRef: text('client_ref'),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  reason: text('reason').notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  discountCents: integer('discount_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  refundCents: integer('refund_cents').notNull(),
  refundMethod: text('refund_method'),
  approvalId: integer('approval_id').references(() => approvals.id),
  drawerSessionId: integer('drawer_session_id').references(() => drawerSessions.id),
  createdBy: text('created_by'),
  userId: integer('user_id').references(() => users.id),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({
  clientRefUnique: uniqueIndex('returns_client_ref_unique').on(t.clientRef),
  invoiceIdx: index('returns_invoice_idx').on(t.invoiceId),
  createdAtIdx: index('returns_created_at_idx').on(t.createdAt),
  drawerIdx: index('returns_drawer_idx').on(t.drawerSessionId),
}));

export const salesReturnLines = sqliteTable('return_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  returnId: integer('return_id').notNull().references(() => salesReturns.id),
  invoiceLineId: integer('invoice_line_id').notNull().references(() => invoiceLines.id),
  qty: integer('qty').notNull(),
  restock: integer('restock', { mode: 'boolean' }).notNull().default(false),
  restockedQty: integer('restocked_qty').notNull().default(0),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  discountCents: integer('discount_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
}, (t) => ({
  returnIdx: index('return_lines_return_idx').on(t.returnId),
  invoiceLineIdx: index('return_lines_invoice_line_idx').on(t.invoiceLineId),
}));
