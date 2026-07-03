CREATE TABLE `job_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`price_cents` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `vendor` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `last_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `taxable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password` text;--> statement-breakpoint
ALTER TABLE `users` ADD `prefs` text;
