CREATE TABLE `grocery_needs` (
	`id` integer PRIMARY KEY NOT NULL,
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
	CONSTRAINT "grocery_needs_quantity" CHECK("grocery_needs"."quantity" > 0),
	CONSTRAINT "grocery_needs_status" CHECK("grocery_needs"."status" in ('to_order', 'ordered', 'received')),
	CONSTRAINT "grocery_needs_store" CHECK("grocery_needs"."status" = 'to_order' or "grocery_needs"."store_id" is not null),
	CONSTRAINT "grocery_needs_ordered" CHECK("grocery_needs"."status" != 'ordered' or "grocery_needs"."ordered_at" is not null),
	CONSTRAINT "grocery_needs_to_order" CHECK("grocery_needs"."status" != 'to_order' or "grocery_needs"."ordered_at" is null),
	CONSTRAINT "grocery_needs_received" CHECK(("grocery_needs"."status" = 'received') = ("grocery_needs"."received_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `grocery_needs_household_status` ON `grocery_needs` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `grocery_needs_item` ON `grocery_needs` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `grocery_needs_household_id` ON `grocery_needs` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_servings` integer NOT NULL,
	`time_zone` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "households_default_servings" CHECK("households"."default_servings" >= 1)
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`household_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_unique` ON `invites` (`email`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`default_store_id` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`default_store_id`) REFERENCES `stores`(`household_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_household_name` ON `items` (`household_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `items_household_id` ON `items` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_household_name` ON `stores` (`household_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `stores_household_id` ON `stores` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_household` ON `users` (`household_id`);