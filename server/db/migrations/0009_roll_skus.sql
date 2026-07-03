CREATE TABLE `material_colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `material_id` integer;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `color` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `nominal_width_in` integer;
