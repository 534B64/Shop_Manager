import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';

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
