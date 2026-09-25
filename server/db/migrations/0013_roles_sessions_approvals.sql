-- Phase 1a hardening (2026-09-25): per-user roles, hashed PINs, server-side
-- sessions, and an append-only manager-approval log. Replaces the single shared
-- admin password. Hand-written like 0009–0012 (drizzle-kit generate is blocked
-- by the snapshot-meta collision — see devlog 2026-07-03). See ADR 0004.
ALTER TABLE `users` ADD `role` text DEFAULT 'cashier' NOT NULL CHECK (`role` IN ('cashier', 'manager', 'admin'));--> statement-breakpoint
ALTER TABLE `users` ADD `pin_hash` text;--> statement-breakpoint
-- Everyone who exists today becomes admin so nobody is locked out; the owner
-- downgrades staff afterwards. Plaintext passwords are hashed into pin_hash by
-- the startup upgrade in server/modules/auth (scrypt needs Node, not SQL).
UPDATE `users` SET `role` = 'admin';--> statement-breakpoint
-- The shared admin password is gone — drop the stored plaintext.
DELETE FROM `settings` WHERE `key` = 'adminPassword';--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`requested_by` integer NOT NULL,
	`approved_by` integer NOT NULL,
	`reason` text,
	`details` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Append-only: the approvals log is audit history, never rewritten.
CREATE TRIGGER `approvals_no_update` BEFORE UPDATE ON `approvals`
BEGIN SELECT RAISE(ABORT, 'approvals is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `approvals_no_delete` BEFORE DELETE ON `approvals`
BEGIN SELECT RAISE(ABORT, 'approvals is append-only'); END;
