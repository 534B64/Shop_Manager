CREATE TABLE `cycle_counts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheduled_for` text NOT NULL,
	`completed_at` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `inventory_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_ref` text,
	`job_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_client_ref_unique` ON `payments` (`client_ref`);