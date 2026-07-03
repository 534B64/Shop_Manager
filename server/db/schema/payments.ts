import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { customers } from './customers.js';
import { jobs } from './jobs.js';

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
