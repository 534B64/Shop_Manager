CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `note` text;--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `po` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `file_ref` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `roll_width_in` real;--> statement-breakpoint
ALTER TABLE `payments` ADD `created_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_po_unique` ON `jobs` (`po`);
