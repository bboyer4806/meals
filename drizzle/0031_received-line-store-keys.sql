PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`store_before_received` integer,
	`default_store_before_received` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`item_id`) REFERENCES `items`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`store_id`) REFERENCES `stores`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`store_before_received`) REFERENCES `stores`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`default_store_before_received`) REFERENCES `stores`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grocery_needs_quantity" CHECK("__new_grocery_needs"."quantity" > 0),
	CONSTRAINT "grocery_needs_status" CHECK("__new_grocery_needs"."status" in ('to_order', 'ordered', 'received')),
	CONSTRAINT "grocery_needs_store" CHECK("__new_grocery_needs"."status" = 'to_order' or "__new_grocery_needs"."store_id" is not null),
	CONSTRAINT "grocery_needs_ordered" CHECK("__new_grocery_needs"."status" != 'ordered' or "__new_grocery_needs"."ordered_at" is not null),
	CONSTRAINT "grocery_needs_to_order" CHECK("__new_grocery_needs"."status" != 'to_order' or "__new_grocery_needs"."ordered_at" is null),
	CONSTRAINT "grocery_needs_received" CHECK(("__new_grocery_needs"."status" = 'received') = ("__new_grocery_needs"."received_at" is not null)),
	CONSTRAINT "grocery_needs_before_received" CHECK("__new_grocery_needs"."status" = 'received' or ("__new_grocery_needs"."store_before_received" is null and "__new_grocery_needs"."default_store_before_received" is null))
);
--> statement-breakpoint
INSERT INTO `__new_grocery_needs`("id", "household_id", "item_id", "quantity", "unit", "store_id", "status", "note", "created_at", "ordered_at", "received_at", "store_before_received", "default_store_before_received") SELECT "id", "household_id", "item_id", "quantity", "unit", "store_id", "status", "note", "created_at", "ordered_at", "received_at", "store_before_received", "default_store_before_received" FROM `grocery_needs`;--> statement-breakpoint
DROP TABLE `grocery_needs`;--> statement-breakpoint
ALTER TABLE `__new_grocery_needs` RENAME TO `grocery_needs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `grocery_needs_household_status` ON `grocery_needs` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `grocery_needs_item` ON `grocery_needs` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `grocery_needs_household_id` ON `grocery_needs` (`household_id`,`id`);