import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';
import { users } from './users.js';

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  // Customer level 0–3 — admin assigned; levels 1+ get an admin-set discount %.
  level: integer('level').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
  // Archive, never delete (ADR 0005): hidden from lists/pickers, kept for history.
  archivedAt: text('archived_at'),
  archivedBy: integer('archived_by').references(() => users.id),
}, (t) => ({
  nameIdx: index('customers_name_idx').on(t.name),
  emailIdx: index('customers_email_idx').on(t.email),
}));
