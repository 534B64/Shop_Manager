import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { nowIso } from './common.js';

export const USER_ROLES = ['cashier', 'manager', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  // LEGACY plaintext (pre-0013). Kept only for migration history: the startup
  // upgrade (modules/auth) hashes it into pinHash and NULLs it. Never read
  // for sign-in.
  password: text('password'),
  // cashier | manager | admin — CHECK-constrained in migration 0013 (ADR 0004).
  role: text('role', { enum: USER_ROLES }).notNull().default('cashier'),
  // "scrypt$<saltHex>$<hashHex>". NULL = no sign-in until an admin sets a PIN.
  pinHash: text('pin_hash'),
  // Per-account preferences: theme, custom accent, dashboard card visibility.
  prefs: text('prefs'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
});

// Server-side sessions (ADR 0004). Only the sha256 of the bearer token is
// stored, so a copied DB file can't be replayed as live logins.
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(), // absolute cap (created + 7 days)
  revokedAt: text('revoked_at'),
}, (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }));

// Manager approvals — append-only (UPDATE/DELETE blocked by triggers in 0013).
// One row per approved sensitive action; approvedBy = requestedBy when a
// manager/admin acted on their own authority.
export const approvals = sqliteTable('approvals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(), // e.g. 'payment.void', 'job.pickup_unpaid'
  entity: text('entity').notNull(), // e.g. 'payment', 'job'
  entityId: text('entity_id'),
  requestedBy: integer('requested_by').notNull().references(() => users.id),
  approvedBy: integer('approved_by').notNull().references(() => users.id),
  reason: text('reason'),
  details: text('details'), // JSON
  createdAt: text('created_at').notNull().$defaultFn(nowIso),
}, (t) => ({ createdAtIdx: index('approvals_created_at_idx').on(t.createdAt) }));

// Audit log (ADR 0005) — append-only (UPDATE/DELETE blocked by triggers in
// 0014). One row per mutation, written in the same transaction as the change
// by modules/audit. before/after are JSON snapshots of the entity.
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull().$defaultFn(nowIso),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(), // e.g. 'customer.archive', 'payment.void'
  entity: text('entity').notNull(), // e.g. 'customer', 'payment'
  entityId: text('entity_id'),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  approvalId: integer('approval_id').references(() => approvals.id),
  requestId: text('request_id'),
}, (t) => ({
  entityIdx: index('audit_log_entity_idx').on(t.entity, t.entityId),
  atIdx: index('audit_log_at_idx').on(t.at),
}));
