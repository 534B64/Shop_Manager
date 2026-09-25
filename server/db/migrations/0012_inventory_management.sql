-- Inventory management pass (2026-07-07): suppliers with lead time, UOM
-- (purchase unit vs count unit + conversion), per-receipt cost history,
-- cycle-count session lines (blind count v2), Min/Max reorder fields, and the
-- counter-sale deduction hook. Hand-written like 0009–0011 (drizzle-kit
-- generate is blocked by the snapshot-meta collision — see devlog 2026-07-03).
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`lead_time_days` integer DEFAULT 7 NOT NULL,
	`contact` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cycle_count_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_count_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`system_count` integer NOT NULL,
	`counted_qty` integer NOT NULL,
	`unit_cost_cents` integer,
	`reason_code` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cycle_count_id`) REFERENCES `cycle_counts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `supplier_id` integer REFERENCES suppliers(id);--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `purchase_unit` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `count_unit` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `purchase_to_count_factor` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `reorder_max_qty` integer;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `avg_daily_use` real;--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `unit_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `supplier_id` integer REFERENCES suppliers(id);--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `cycle_count_id` integer REFERENCES cycle_counts(id);--> statement-breakpoint
ALTER TABLE `cycle_counts` ADD `completed_by` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `default_supplier_id` integer REFERENCES suppliers(id);--> statement-breakpoint
-- Backfill: one supplier per distinct vendor string (case-insensitive), from
-- item vendors first, then category default vendors not already present. The
-- text columns stay for history; the UI stops writing them after this pass.
INSERT INTO `suppliers` (`name`, `lead_time_days`, `created_at`)
SELECT trim(`vendor`), 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `inventory_items`
WHERE `vendor` IS NOT NULL AND trim(`vendor`) <> ''
GROUP BY lower(trim(`vendor`));--> statement-breakpoint
INSERT INTO `suppliers` (`name`, `lead_time_days`, `created_at`)
SELECT trim(`default_vendor`), 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `categories`
WHERE `default_vendor` IS NOT NULL AND trim(`default_vendor`) <> ''
	AND lower(trim(`default_vendor`)) NOT IN (SELECT lower(`name`) FROM `suppliers`)
GROUP BY lower(trim(`default_vendor`));--> statement-breakpoint
UPDATE `inventory_items` SET `supplier_id` =
	(SELECT `s`.`id` FROM `suppliers` `s` WHERE lower(`s`.`name`) = lower(trim(`inventory_items`.`vendor`)))
WHERE `vendor` IS NOT NULL AND trim(`vendor`) <> '';--> statement-breakpoint
UPDATE `categories` SET `default_supplier_id` =
	(SELECT `s`.`id` FROM `suppliers` `s` WHERE lower(`s`.`name`) = lower(trim(`categories`.`default_vendor`)))
WHERE `default_vendor` IS NOT NULL AND trim(`default_vendor`) <> '';--> statement-breakpoint
-- Roll SKUs are bought and counted in whole rolls by decision (see CLAUDE.md);
-- make that explicit so the UOM display doesn't read as "unset" on them.
UPDATE `inventory_items` SET `purchase_unit` = 'roll', `count_unit` = 'roll'
WHERE `material_id` IS NOT NULL AND `nominal_width_in` IS NOT NULL;--> statement-breakpoint
-- No two suppliers with the same name (case-insensitive) — same guard style as
-- roll_sku_unique in 0011.
CREATE UNIQUE INDEX IF NOT EXISTS `suppliers_name_unique` ON `suppliers` (lower(`name`));
