PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dish_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text DEFAULT 'dish' NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`dish_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dish_requests_kind" CHECK("__new_dish_requests"."kind" in ('dish', 'restaurant')),
	CONSTRAINT "dish_requests_kind_dish" CHECK(("__new_dish_requests"."kind" = 'dish') = ("__new_dish_requests"."dish_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_dish_requests`("id", "household_id", "user_id", "kind", "name", "note", "dish_id", "created_at") SELECT "id", "household_id", "user_id", "kind", "name", "note", "dish_id", "created_at" FROM `dish_requests`;--> statement-breakpoint
DROP TABLE `dish_requests`;--> statement-breakpoint
ALTER TABLE `__new_dish_requests` RENAME TO `dish_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `dish_requests_household` ON `dish_requests` (`household_id`);--> statement-breakpoint
CREATE INDEX `dish_requests_user` ON `dish_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `dish_requests_dish` ON `dish_requests` (`dish_id`);--> statement-breakpoint
CREATE TABLE `__new_grocery_needs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` real NOT NULL,
	`unit` text,
	`store_id` integer,
	`status` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`ordered_at` integer,
	`received_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`item_id`) REFERENCES `items`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`store_id`) REFERENCES `stores`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grocery_needs_quantity" CHECK("__new_grocery_needs"."quantity" > 0),
	CONSTRAINT "grocery_needs_status" CHECK("__new_grocery_needs"."status" in ('to_order', 'ordered', 'received')),
	CONSTRAINT "grocery_needs_store" CHECK("__new_grocery_needs"."status" = 'to_order' or "__new_grocery_needs"."store_id" is not null),
	CONSTRAINT "grocery_needs_ordered" CHECK("__new_grocery_needs"."status" != 'ordered' or "__new_grocery_needs"."ordered_at" is not null),
	CONSTRAINT "grocery_needs_to_order" CHECK("__new_grocery_needs"."status" != 'to_order' or "__new_grocery_needs"."ordered_at" is null),
	CONSTRAINT "grocery_needs_received" CHECK(("__new_grocery_needs"."status" = 'received') = ("__new_grocery_needs"."received_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_grocery_needs`("id", "household_id", "item_id", "quantity", "unit", "store_id", "status", "note", "created_at", "ordered_at", "received_at") SELECT "id", "household_id", "item_id", "quantity", "unit", "store_id", "status", "note", "created_at", "ordered_at", "received_at" FROM `grocery_needs`;--> statement-breakpoint
DROP TABLE `grocery_needs`;--> statement-breakpoint
ALTER TABLE `__new_grocery_needs` RENAME TO `grocery_needs`;--> statement-breakpoint
CREATE INDEX `grocery_needs_household_status` ON `grocery_needs` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `grocery_needs_item` ON `grocery_needs` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `grocery_needs_household_id` ON `grocery_needs` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`household_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invites`("id", "email", "household_id", "created_at") SELECT "id", "email", "household_id", "created_at" FROM `invites`;--> statement-breakpoint
DROP TABLE `invites`;--> statement-breakpoint
ALTER TABLE `__new_invites` RENAME TO `invites`;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_unique` ON `invites` (`email`);