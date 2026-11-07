CREATE TABLE `party_allocations` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`party_item_id` integer NOT NULL,
	`need_id` integer NOT NULL,
	`quantity` real NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`party_item_id`) REFERENCES `party_items`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`need_id`) REFERENCES `grocery_needs`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "party_allocations_quantity" CHECK("party_allocations"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `party_allocations_party_item` ON `party_allocations` (`party_item_id`);--> statement-breakpoint
CREATE INDEX `party_allocations_need` ON `party_allocations` (`need_id`);--> statement-breakpoint
CREATE TABLE `party_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`party_list_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`unit` text,
	`bought_quantity` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`party_list_id`) REFERENCES `party_lists`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`item_id`) REFERENCES `items`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "party_items_quantity" CHECK("party_items"."quantity" > 0),
	CONSTRAINT "party_items_bought" CHECK("party_items"."bought_quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_items_list_item` ON `party_items` (`party_list_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `party_items_item` ON `party_items` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `party_items_household_id` ON `party_items` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `party_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_lists_household_name` ON `party_lists` (`household_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `party_lists_household_id` ON `party_lists` (`household_id`,`id`);