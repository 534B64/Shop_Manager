import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';

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
