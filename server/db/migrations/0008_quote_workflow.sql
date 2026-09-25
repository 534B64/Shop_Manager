ALTER TABLE `materials` ADD `uses_roll` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `materials` ADD `is_addon` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `main_color_mult` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `job_items` ADD `complexity` integer;
--> statement-breakpoint
ALTER TABLE `job_items` ADD `roll_width_in` real;
--> statement-breakpoint
ALTER TABLE `job_items` ADD `color_mult` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `materials` SET `uses_roll` = true
  WHERE `name` LIKE '%651%' OR `name` LIKE 'Cast%' OR `name` LIKE 'Calendered%';
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, min_qty, color_multiplier, uses_roll, is_addon, created_at)
SELECT 'T-shirt blank','each',350,'flat',600,1,0,0,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name = 'T-shirt blank');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, min_qty, color_multiplier, uses_roll, is_addon, created_at)
SELECT 'Squeegee','each',150,'flat',400,1,0,0,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name = 'Squeegee');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, min_qty, color_multiplier, uses_roll, is_addon, created_at)
SELECT 'Other (manual price)','each',0,'custom',0,1,0,0,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name = 'Other (manual price)');
