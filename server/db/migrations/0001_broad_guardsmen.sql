ALTER TABLE `jobs` ADD `client_ref` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `width_in` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `height_in` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `complexity` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `material_id` integer REFERENCES materials(id);--> statement-breakpoint
ALTER TABLE `jobs` ADD `material_cost_snapshot_cents` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_client_ref_unique` ON `jobs` (`client_ref`);
