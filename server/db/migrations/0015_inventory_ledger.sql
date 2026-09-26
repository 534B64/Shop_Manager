-- Phase 2 (2026-09-26, ADR 0006): perpetual inventory ledger. The existing
-- inventory_adjustments table becomes the "inventory transaction" ledger in
-- place; on-hand only ever moves through it, and the database enforces that.
-- Hand-written like 0009–0014 (drizzle-kit generate is blocked by the
-- snapshot-meta collision — see devlog 2026-07-03).

-- ---- Locations + per-location balances ----
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	`archived_by` integer REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_name_unique` ON `locations` (lower(`name`));--> statement-breakpoint
-- id 1 is the default location every existing count moves to (DEFAULT_LOCATION_ID).
INSERT INTO `locations` (`id`, `name`, `created_at`) VALUES (1, 'Shop', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
CREATE TRIGGER `locations_no_delete` BEFORE DELETE ON `locations`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;--> statement-breakpoint
CREATE TABLE `inventory_balances` (
	`item_id` integer NOT NULL REFERENCES `inventory_items`(`id`),
	`location_id` integer NOT NULL REFERENCES `locations`(`id`),
	`on_hand` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`item_id`, `location_id`)
);
--> statement-breakpoint
CREATE INDEX `inventory_balances_location_idx` ON `inventory_balances` (`location_id`);--> statement-breakpoint

-- ---- Evolve inventory_adjustments into the transaction ledger ----
-- The append-only trigger is lifted only for the backfill below, then restored.
DROP TRIGGER `inventory_adjustments_no_update`;--> statement-breakpoint
-- The old unit_cost_cents was cost per PURCHASE unit on receipts; it keeps
-- that meaning under a clearer name, and unit_cost_cents becomes cost per
-- COUNT unit on every row.
ALTER TABLE `inventory_adjustments` RENAME COLUMN `unit_cost_cents` TO `purchase_unit_cost_cents`;--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `unit_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `txn_type` text NOT NULL DEFAULT 'adjustment';--> statement-breakpoint
-- Nullable only because SQLite can't ADD a REFERENCES column with a non-null
-- default while foreign keys are on; the insert trigger below requires it.
ALTER TABLE `inventory_adjustments` ADD `location_id` integer REFERENCES `locations`(`id`);--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `source_type` text NOT NULL DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `user_id` integer REFERENCES `users`(`id`);--> statement-breakpoint
UPDATE `inventory_adjustments` SET
	`location_id` = 1,
	`txn_type` = CASE
		WHEN `cycle_count_id` IS NOT NULL OR `reason` = 'cycle_count' THEN 'count'
		WHEN `reason` = 'received' THEN 'receipt'
		WHEN `reason` = 'sold' THEN 'sale'
		WHEN `reason` IN ('used', 'production_use') THEN 'production'
		ELSE 'adjustment' END,
	`source_type` = CASE
		WHEN `cycle_count_id` IS NOT NULL THEN 'cycle_count'
		WHEN `reason` = 'received' THEN 'receipt'
		ELSE 'manual' END,
	`source_id` = CASE WHEN `cycle_count_id` IS NOT NULL THEN CAST(`cycle_count_id` AS text) END,
	`unit_cost_cents` = CASE WHEN `reason` = 'received' AND `purchase_unit_cost_cents` IS NOT NULL THEN
		CAST(round(`purchase_unit_cost_cents` * 1.0 / (SELECT CASE WHEN `i`.`purchase_to_count_factor` > 0 THEN `i`.`purchase_to_count_factor` ELSE 1 END
			FROM `inventory_items` `i` WHERE `i`.`id` = `inventory_adjustments`.`item_id`)) AS integer) END;--> statement-breakpoint
-- Counter sales: the job id lives in the note ("… (job #123)").
UPDATE `inventory_adjustments` SET `source_type` = 'job',
	`source_id` = substr(`note`, instr(`note`, '(job #') + 6, instr(substr(`note`, instr(`note`, '(job #') + 6), ')') - 1)
WHERE `reason` = 'sold' AND `note` LIKE '%(job #%)%';--> statement-breakpoint

-- Opening balance: whatever the item count holds that the ledger never
-- explained (items created with a starting count, pre-ledger history). Dated
-- at the item's creation so it sits at the start of its history.
INSERT INTO `inventory_adjustments` (`item_id`, `delta`, `reason`, `note`, `created_by`, `created_at`,
	`txn_type`, `location_id`, `source_type`, `source_id`, `user_id`)
SELECT `i`.`id`, `i`.`count` - coalesce((SELECT sum(`a`.`delta`) FROM `inventory_adjustments` `a` WHERE `a`.`item_id` = `i`.`id`), 0),
	'opening balance', 'Phase 2 migration: on-hand not explained by earlier history', NULL, `i`.`created_at`,
	'opening', 1, 'migration', '0015', NULL
FROM `inventory_items` `i`
WHERE `i`.`count` <> coalesce((SELECT sum(`a`.`delta`) FROM `inventory_adjustments` `a` WHERE `a`.`item_id` = `i`.`id`), 0);--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_no_update` BEFORE UPDATE ON `inventory_adjustments`
BEGIN SELECT RAISE(ABORT, 'inventory_adjustments is append-only'); END;--> statement-breakpoint
INSERT INTO `inventory_balances` (`item_id`, `location_id`, `on_hand`)
SELECT `item_id`, `location_id`, sum(`delta`) FROM `inventory_adjustments` GROUP BY `item_id`, `location_id`;--> statement-breakpoint
-- Keyset pagination of an item's transactions, and a covering index for the
-- per-item / per-location sums the guards below compute.
CREATE INDEX `inventory_adjustments_item_id_idx` ON `inventory_adjustments` (`item_id`, `id`);--> statement-breakpoint
CREATE INDEX `inventory_adjustments_item_loc_delta_idx` ON `inventory_adjustments` (`item_id`, `location_id`, `delta`);--> statement-breakpoint

-- ---- Moving weighted-average cost (per COUNT unit) ----
ALTER TABLE `inventory_items` ADD `avg_cost_cents` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `inventory_items` SET `avg_cost_cents` = coalesce(
	(SELECT `a`.`unit_cost_cents` FROM `inventory_adjustments` `a`
		WHERE `a`.`item_id` = `inventory_items`.`id` AND `a`.`txn_type` = 'receipt' AND `a`.`unit_cost_cents` IS NOT NULL
		ORDER BY `a`.`created_at` DESC, `a`.`id` DESC LIMIT 1),
	CAST(round(`last_cost_cents` * 1.0 / CASE WHEN `purchase_to_count_factor` > 0 THEN `purchase_to_count_factor` ELSE 1 END) AS integer),
	0);--> statement-breakpoint

-- ---- Cycle count approval flow: counting → submitted → posted ----
ALTER TABLE `cycle_counts` ADD `status` text NOT NULL DEFAULT 'counting';--> statement-breakpoint
ALTER TABLE `cycle_counts` ADD `submission` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `cycle_counts` ADD `submitted_at` text;--> statement-breakpoint
ALTER TABLE `cycle_counts` ADD `submitted_by` text;--> statement-breakpoint
ALTER TABLE `cycle_counts` ADD `posted_by` text;--> statement-breakpoint
ALTER TABLE `cycle_counts` ADD `next_scheduled_for` text;--> statement-breakpoint
UPDATE `cycle_counts` SET `status` = 'posted', `submission` = 1 WHERE `completed_at` IS NOT NULL;--> statement-breakpoint
-- Lines are append-only, so a sent-back submission's lines stay; `submission`
-- says which round they belong to (the posted round is the one that counts).
ALTER TABLE `cycle_count_lines` ADD `submission` integer NOT NULL DEFAULT 1;--> statement-breakpoint

-- ---- The invariant: on-hand only moves through the ledger ----
CREATE TRIGGER `inventory_adjustments_require_location` BEFORE INSERT ON `inventory_adjustments`
WHEN NEW.`location_id` IS NULL
BEGIN SELECT RAISE(ABORT, 'inventory transaction needs a location'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_apply` AFTER INSERT ON `inventory_adjustments`
BEGIN
	INSERT OR IGNORE INTO `inventory_balances` (`item_id`, `location_id`, `on_hand`) VALUES (NEW.`item_id`, NEW.`location_id`, 0);
	UPDATE `inventory_balances` SET `on_hand` = `on_hand` + NEW.`delta`
		WHERE `item_id` = NEW.`item_id` AND `location_id` = NEW.`location_id`;
	UPDATE `inventory_items` SET `count` = `count` + NEW.`delta` WHERE `id` = NEW.`item_id`;
END;--> statement-breakpoint
CREATE TRIGGER `inventory_items_count_new` BEFORE INSERT ON `inventory_items`
WHEN NEW.`count` <> 0
BEGIN SELECT RAISE(ABORT, 'on-hand only moves through inventory transactions — create the item at 0 and post an opening transaction'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_items_count_guard` BEFORE UPDATE OF `count` ON `inventory_items`
WHEN NEW.`count` IS NOT (SELECT coalesce(sum(`delta`), 0) FROM `inventory_adjustments` WHERE `item_id` = NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'on-hand only moves through inventory transactions'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_balances_new` BEFORE INSERT ON `inventory_balances`
WHEN NEW.`on_hand` <> 0
BEGIN SELECT RAISE(ABORT, 'on-hand only moves through inventory transactions'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_balances_guard` BEFORE UPDATE ON `inventory_balances`
WHEN NEW.`item_id` IS NOT OLD.`item_id` OR NEW.`location_id` IS NOT OLD.`location_id`
	OR NEW.`on_hand` IS NOT (SELECT coalesce(sum(`delta`), 0) FROM `inventory_adjustments`
		WHERE `item_id` = NEW.`item_id` AND `location_id` = NEW.`location_id`)
BEGIN SELECT RAISE(ABORT, 'on-hand only moves through inventory transactions'); END;--> statement-breakpoint
CREATE TRIGGER `inventory_balances_no_delete` BEFORE DELETE ON `inventory_balances`
BEGIN SELECT RAISE(ABORT, 'hard delete not allowed'); END;
