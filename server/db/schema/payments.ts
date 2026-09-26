import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { customers } from './customers.js';
import { jobs } from './jobs.js';
import { drawerSessions, salesReturns, invoiceVoids } from './sales.js';

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
  // Phase 3 (ADR 0007): the drawer session the row was taken in (every cash
  // row has one), cash tendered + change given, and what a refund was for.
  drawerSessionId: integer('drawer_session_id').references(() => drawerSessions.id),
  tenderedCents: integer('tendered_cents'),
  changeCents: integer('change_cents'),
  returnId: integer('return_id').references(() => salesReturns.id),
  invoiceVoidId: integer('invoice_void_id').references(() => invoiceVoids.id),
}, (t) => ({
  drawerIdx: index('payments_drawer_idx').on(t.drawerSessionId),
  // Immutable except the void fields (trigger in 0014, ADR 0005).
  jobIdx: index('payments_job_idx').on(t.jobId),
  createdAtIdx: index('payments_created_at_idx').on(t.createdAt),
}));

export const customerCredits = sqliteTable('customer_credits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  deltaCents: integer('delta_cents').notNull(), // + add credit, − apply credit
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({ customerIdx: index('customer_credits_customer_idx').on(t.customerId) }));
