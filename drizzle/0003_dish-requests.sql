CREATE TABLE `dish_requests` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`dish_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dish_requests_household` ON `dish_requests` (`household_id`);--> statement-breakpoint
CREATE INDEX `dish_requests_user` ON `dish_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `dish_requests_dish` ON `dish_requests` (`dish_id`);