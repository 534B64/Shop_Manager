-- Phase 3 (2026-09-26, ADR 0007): POS governance — locked invoices with a
-- gap-free number, per-line tax, invoice voids, returns (RMAs), and cash
-- drawer sessions with a Z-report. Hand-written like 0009–0015 (drizzle-kit
-- generate is blocked by the snapshot-meta collision — see devlog 2026-07-03).

-- ---- Number sequences: the only source of invoice numbers ----
-- A number is taken by `UPDATE … SET next_value = next_value + 1` inside the
-- transaction that inserts the invoice, so a rolled-back sale gives it back.
CREATE TABLE `number_sequences` (
	`name` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `number_sequences` (`name`, `next_value`) VALUES ('invoice', 1);--> statement-breakpoint
CREATE TRIGGER `number_sequences_no_delete` BEFORE DELETE ON `number_sequences`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TRIGGER `number_sequences_step` BEFORE UPDATE ON `number_sequences`
WHEN NEW.`name` IS NOT OLD.`name` OR NEW.`next_value` IS NOT OLD.`next_value` + 1
BEGIN SELECT RAISE(ABORT, 'number sequences only step forward by one'); END;--> statement-breakpoint

-- ---- Cash drawer sessions (one open per register; register 1 today) ----
CREATE TABLE `drawer_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`register_id` integer NOT NULL DEFAULT 1,
	`status` text NOT NULL DEFAULT 'open' CHECK (`status` IN ('open', 'closed')),
	`opened_at` text NOT NULL,
	`opened_by` integer NOT NULL REFERENCES `users`(`id`),
	`opening_float_cents` integer NOT NULL CHECK (`opening_float_cents` >= 0),
	`open_note` text,
	`closed_at` text,
	`closed_by` integer REFERENCES `users`(`id`),
	`expected_cash_cents` integer,
	`counted_cash_cents` integer,
	`over_short_cents` integer,
	`expected_checks_cents` integer,
	`counted_checks_cents` integer,
	`checks_over_short_cents` integer,
	`close_note` text,
	`z_report_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drawer_sessions_one_open` ON `drawer_sessions` (`register_id`) WHERE `status` = 'open';--> statement-breakpoint
CREATE INDEX `drawer_sessions_opened_at_idx` ON `drawer_sessions` (`opened_at`);--> statement-breakpoint
CREATE TRIGGER `drawer_sessions_no_delete` BEFORE DELETE ON `drawer_sessions`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
-- The only update is the one-time close (open → closed); a closed session
-- and its Z-report never change again.
CREATE TRIGGER `drawer_sessions_immutable` BEFORE UPDATE ON `drawer_sessions`
WHEN OLD.`status` <> 'open' OR NEW.`status` <> 'closed'
  OR NEW.`id` IS NOT OLD.`id`
  OR NEW.`register_id` IS NOT OLD.`register_id`
  OR NEW.`opened_at` IS NOT OLD.`opened_at`
  OR NEW.`opened_by` IS NOT OLD.`opened_by`
  OR NEW.`opening_float_cents` IS NOT OLD.`opening_float_cents`
  OR NEW.`open_note` IS NOT OLD.`open_note`
BEGIN SELECT RAISE(ABORT, 'drawer sessions only change once, when closed'); END;--> statement-breakpoint

-- ---- Invoices: locked snapshots, never updated or deleted ----
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`job_id` integer NOT NULL REFERENCES `jobs`(`id`),
	`customer_id` integer REFERENCES `customers`(`id`),
	`customer_name` text,
	`job_po` text,
	`title` text NOT NULL,
	`source` text NOT NULL CHECK (`source` IN ('job', 'counter_sale')),
	`tax_rate_pct` real NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`discount_pct` real NOT NULL DEFAULT 0,
	`discount_cents` integer NOT NULL DEFAULT 0,
	`total_cents` integer NOT NULL,
	`drawer_session_id` integer REFERENCES `drawer_sessions`(`id`),
	`created_by` text,
	`user_id` integer REFERENCES `users`(`id`),
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE INDEX `invoices_created_at_idx` ON `invoices` (`created_at`);--> statement-breakpoint
CREATE INDEX `invoices_job_idx` ON `invoices` (`job_id`);--> statement-breakpoint
CREATE INDEX `invoices_customer_idx` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE INDEX `invoices_drawer_idx` ON `invoices` (`drawer_session_id`);--> statement-breakpoint
-- The number must be the one just taken from the sequence: with the unique
-- index and the +1-only sequence, invoice numbers can't skip or repeat.
CREATE TRIGGER `invoices_number_from_sequence` BEFORE INSERT ON `invoices`
WHEN NEW.`number` IS NOT (SELECT `next_value` - 1 FROM `number_sequences` WHERE `name` = 'invoice')
BEGIN SELECT RAISE(ABORT, 'invoice number must come from the invoice sequence'); END;--> statement-breakpoint
CREATE TRIGGER `invoices_no_update` BEFORE UPDATE ON `invoices`
BEGIN SELECT RAISE(ABORT, 'invoices are immutable — void or return instead'); END;--> statement-breakpoint
CREATE TRIGGER `invoices_no_delete` BEFORE DELETE ON `invoices`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint

CREATE TABLE `invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL REFERENCES `invoices`(`id`),
	`line_no` integer NOT NULL,
	`description` text NOT NULL,
	`detail` text,
	`qty` integer NOT NULL CHECK (`qty` > 0),
	`unit_price_cents` integer NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`suggested_cents` integer,
	`taxable` integer NOT NULL,
	`tax_rate_pct` real NOT NULL,
	`tax_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL DEFAULT 0,
	`total_cents` integer NOT NULL,
	`inventory_item_id` integer REFERENCES `inventory_items`(`id`),
	`stock_qty` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TRIGGER `invoice_lines_no_update` BEFORE UPDATE ON `invoice_lines`
BEGIN SELECT RAISE(ABORT, 'invoice lines are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_lines_no_delete` BEFORE DELETE ON `invoice_lines`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint

-- ---- Invoice voids: one per invoice, append-only ----
CREATE TABLE `invoice_voids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL REFERENCES `invoices`(`id`),
	`reason` text NOT NULL,
	`refund_cents` integer NOT NULL DEFAULT 0,
	`job_archived` integer NOT NULL DEFAULT 1,
	`approval_id` integer REFERENCES `approvals`(`id`),
	`drawer_session_id` integer REFERENCES `drawer_sessions`(`id`),
	`created_by` text,
	`user_id` integer REFERENCES `users`(`id`),
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_voids_invoice_unique` ON `invoice_voids` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_voids_created_at_idx` ON `invoice_voids` (`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_voids_drawer_idx` ON `invoice_voids` (`drawer_session_id`);--> statement-breakpoint
CREATE TRIGGER `invoice_voids_no_update` BEFORE UPDATE ON `invoice_voids`
BEGIN SELECT RAISE(ABORT, 'invoice_voids is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_voids_no_delete` BEFORE DELETE ON `invoice_voids`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint

-- ---- Returns (RMAs) + their lines, append-only ----
CREATE TABLE `returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_ref` text,
	`invoice_id` integer NOT NULL REFERENCES `invoices`(`id`),
	`reason` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`refund_cents` integer NOT NULL,
	`refund_method` text,
	`approval_id` integer REFERENCES `approvals`(`id`),
	`drawer_session_id` integer REFERENCES `drawer_sessions`(`id`),
	`created_by` text,
	`user_id` integer REFERENCES `users`(`id`),
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `returns_client_ref_unique` ON `returns` (`client_ref`);--> statement-breakpoint
CREATE INDEX `returns_invoice_idx` ON `returns` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `returns_created_at_idx` ON `returns` (`created_at`);--> statement-breakpoint
CREATE INDEX `returns_drawer_idx` ON `returns` (`drawer_session_id`);--> statement-breakpoint
CREATE TRIGGER `returns_no_update` BEFORE UPDATE ON `returns`
BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `returns_no_delete` BEFORE DELETE ON `returns`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TABLE `return_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_id` integer NOT NULL REFERENCES `returns`(`id`),
	`invoice_line_id` integer NOT NULL REFERENCES `invoice_lines`(`id`),
	`qty` integer NOT NULL CHECK (`qty` > 0),
	`restock` integer NOT NULL DEFAULT 0,
	`restocked_qty` integer NOT NULL DEFAULT 0,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`total_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `return_lines_return_idx` ON `return_lines` (`return_id`);--> statement-breakpoint
CREATE INDEX `return_lines_invoice_line_idx` ON `return_lines` (`invoice_line_id`);--> statement-breakpoint
CREATE TRIGGER `return_lines_no_update` BEFORE UPDATE ON `return_lines`
BEGIN SELECT RAISE(ABORT, 'return lines are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `return_lines_no_delete` BEFORE DELETE ON `return_lines`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint

-- ---- Payments: drawer, cash tender, and what a refund row was for ----
ALTER TABLE `payments` ADD `drawer_session_id` integer REFERENCES `drawer_sessions`(`id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `tendered_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `change_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `return_id` integer REFERENCES `returns`(`id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `invoice_void_id` integer REFERENCES `invoice_voids`(`id`);--> statement-breakpoint
CREATE INDEX `payments_drawer_idx` ON `payments` (`drawer_session_id`);--> statement-breakpoint
DROP TRIGGER `payments_immutable`;--> statement-breakpoint
CREATE TRIGGER `payments_immutable` BEFORE UPDATE ON `payments`
WHEN NEW.`amount_cents` IS NOT OLD.`amount_cents`
  OR NEW.`method` IS NOT OLD.`method`
  OR NEW.`kind` IS NOT OLD.`kind`
  OR NEW.`job_id` IS NOT OLD.`job_id`
  OR NEW.`client_ref` IS NOT OLD.`client_ref`
  OR NEW.`created_by` IS NOT OLD.`created_by`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`note` IS NOT OLD.`note`
  OR NEW.`drawer_session_id` IS NOT OLD.`drawer_session_id`
  OR NEW.`tendered_cents` IS NOT OLD.`tendered_cents`
  OR NEW.`change_cents` IS NOT OLD.`change_cents`
  OR NEW.`return_id` IS NOT OLD.`return_id`
  OR NEW.`invoice_void_id` IS NOT OLD.`invoice_void_id`
  OR OLD.`voided_at` IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'payments are immutable — only an unvoided payment can be voided'); END;--> statement-breakpoint

-- ---- Jobs: the tax rate their stored total was computed with ----
ALTER TABLE `jobs` ADD `tax_rate_pct` real;
