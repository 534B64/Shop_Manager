CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_unit` text,
	`tracks_color` integer DEFAULT false NOT NULL,
	`default_vendor` text,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`label` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `category_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`options` text,
	`required` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `category_id` integer;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `size_text` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `custom` text;--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `order_note` text;
