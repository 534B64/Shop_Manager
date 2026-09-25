CREATE TABLE `customer_credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`delta_cents` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `materials` ADD `labor_factor_pct` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `kind` text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `void_reason` text;
