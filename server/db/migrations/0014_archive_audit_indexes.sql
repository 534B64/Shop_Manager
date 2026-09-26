-- Phase 1b hardening (2026-09-25, ADR 0005): archive instead of delete, an
-- append-only audit log, hard-delete/immutability triggers, and indexes for
-- the common lookups. Hand-written like 0009–0013 (drizzle-kit generate is
-- blocked by the snapshot-meta collision — see devlog 2026-07-03).

-- ---- Archive columns: "delete" now hides the row, it never removes it ----
ALTER TABLE `customers` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `archived_by` integer REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `categories` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `archived_by` integer REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `category_sizes` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `category_sizes` ADD `archived_by` integer REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `suppliers` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `archived_by` integer REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `materials` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `archived_by` integer REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `material_colors` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `material_colors` ADD `archived_by` integer REFERENCES `users`(`id`);--> statement-breakpoint
-- Job edits used to delete + re-insert every line; replaced lines are now
-- soft-deleted so the quote history survives.
ALTER TABLE `job_items` ADD `deleted_at` text;--> statement-breakpoint

-- ---- Audit log (append-only) ----
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`before_json` text,
	`after_json` text,
	`approval_id` integer,
	`request_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `approvals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`, `entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;--> statement-breakpoint

-- ---- No hard deletes (approvals already has its trigger from 0013) ----
CREATE TRIGGER `payments_no_delete` BEFORE DELETE ON `payments`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `customer_credits_no_delete` BEFORE DELETE ON `customer_credits`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_no_delete` BEFORE DELETE ON `inventory_adjustments`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `cycle_counts_no_delete` BEFORE DELETE ON `cycle_counts`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `cycle_count_lines_no_delete` BEFORE DELETE ON `cycle_count_lines`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `jobs_no_delete` BEFORE DELETE ON `jobs`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `job_items_no_delete` BEFORE DELETE ON `job_items`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `customers_no_delete` BEFORE DELETE ON `customers`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `suppliers_no_delete` BEFORE DELETE ON `suppliers`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `categories_no_delete` BEFORE DELETE ON `categories`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `category_sizes_no_delete` BEFORE DELETE ON `category_sizes`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `materials_no_delete` BEFORE DELETE ON `materials`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `material_colors_no_delete` BEFORE DELETE ON `material_colors`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_items_no_delete` BEFORE DELETE ON `inventory_items`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `users_no_delete` BEFORE DELETE ON `users`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint

-- ---- Immutable money / ledger rows ----
-- Payments: only the void fields may change, and only once (no un-voiding).
CREATE TRIGGER `payments_immutable` BEFORE UPDATE ON `payments`
WHEN NEW.`amount_cents` IS NOT OLD.`amount_cents`
  OR NEW.`method` IS NOT OLD.`method`
  OR NEW.`kind` IS NOT OLD.`kind`
  OR NEW.`job_id` IS NOT OLD.`job_id`
  OR NEW.`client_ref` IS NOT OLD.`client_ref`
  OR NEW.`created_by` IS NOT OLD.`created_by`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`note` IS NOT OLD.`note`
  OR OLD.`voided_at` IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'payments are immutable — only an unvoided payment can be voided'); END;--> statement-breakpoint
CREATE TRIGGER `customer_credits_no_update` BEFORE UPDATE ON `customer_credits`
BEGIN SELECT RAISE(ABORT, 'customer_credits is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_no_update` BEFORE UPDATE ON `inventory_adjustments`
BEGIN SELECT RAISE(ABORT, 'inventory_adjustments is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `cycle_count_lines_no_update` BEFORE UPDATE ON `cycle_count_lines`
BEGIN SELECT RAISE(ABORT, 'cycle_count_lines is append-only'); END;--> statement-breakpoint

-- ---- Indexes for common lookups (jobs.po, roll SKU, sessions.user_id and
-- suppliers.name are already indexed; inventory_items has no sku/barcode column) ----
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_customer_idx` ON `jobs` (`customer_id`);--> statement-breakpoint
CREATE INDEX `job_items_job_idx` ON `job_items` (`job_id`);--> statement-breakpoint
CREATE INDEX `payments_job_idx` ON `payments` (`job_id`);--> statement-breakpoint
CREATE INDEX `payments_created_at_idx` ON `payments` (`created_at`);--> statement-breakpoint
CREATE INDEX `customer_credits_customer_idx` ON `customer_credits` (`customer_id`);--> statement-breakpoint
CREATE INDEX `inventory_adjustments_item_created_idx` ON `inventory_adjustments` (`item_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `inventory_adjustments_created_at_idx` ON `inventory_adjustments` (`created_at`);--> statement-breakpoint
CREATE INDEX `cycle_count_lines_count_idx` ON `cycle_count_lines` (`cycle_count_id`);--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `approvals_created_at_idx` ON `approvals` (`created_at`);
