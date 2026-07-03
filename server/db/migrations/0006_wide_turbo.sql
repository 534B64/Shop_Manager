ALTER TABLE `customers` ADD `level` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `job_items` ADD `material_id` integer REFERENCES materials(id);
--> statement-breakpoint
ALTER TABLE `job_items` ADD `width_in` real;
--> statement-breakpoint
ALTER TABLE `job_items` ADD `height_in` real;
--> statement-breakpoint
ALTER TABLE `job_items` ADD `file_ref` text;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `discount_pct` real;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `total_cents` integer;
--> statement-breakpoint
ALTER TABLE `materials` ADD `price_mode` text DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE `materials` ADD `rate_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `materials` ADD `rate2_cents` integer;
--> statement-breakpoint
ALTER TABLE `materials` ADD `min_qty` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `materials` ADD `color_multiplier` integer DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE `jobs` SET `status` = 'acknowledged' WHERE `status` = 'order';
--> statement-breakpoint
UPDATE `jobs` SET `status` = 'in_progress' WHERE `status` = 'in_production';
