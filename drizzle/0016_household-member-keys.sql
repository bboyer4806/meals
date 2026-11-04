PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dish_ratings` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`dish_id` integer NOT NULL,
	`user_id` integer,
	`stars` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`user_id`) REFERENCES `users`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dish_ratings_stars" CHECK("__new_dish_ratings"."stars" between 1 and 5)
);
--> statement-breakpoint
INSERT INTO `__new_dish_ratings`("id", "household_id", "dish_id", "user_id", "stars") SELECT "id", "household_id", "dish_id", "user_id", "stars" FROM `dish_ratings`;--> statement-breakpoint
DROP TABLE `dish_ratings`;--> statement-breakpoint
ALTER TABLE `__new_dish_ratings` RENAME TO `dish_ratings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `dish_ratings_dish_user` ON `dish_ratings` (`dish_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `dish_ratings_household` ON `dish_ratings` (`household_id`);--> statement-breakpoint
CREATE INDEX `dish_ratings_user` ON `dish_ratings` (`user_id`);--> statement-breakpoint
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
	FOREIGN KEY (`household_id`,`user_id`) REFERENCES `users`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dish_requests_kind" CHECK("__new_dish_requests"."kind" in ('dish', 'restaurant')),
	CONSTRAINT "dish_requests_kind_dish" CHECK(("__new_dish_requests"."kind" = 'dish') = ("__new_dish_requests"."dish_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_dish_requests`("id", "household_id", "user_id", "kind", "name", "note", "dish_id", "created_at") SELECT "id", "household_id", "user_id", "kind", "name", "note", "dish_id", "created_at" FROM `dish_requests`;--> statement-breakpoint
DROP TABLE `dish_requests`;--> statement-breakpoint
ALTER TABLE `__new_dish_requests` RENAME TO `dish_requests`;--> statement-breakpoint
CREATE INDEX `dish_requests_household` ON `dish_requests` (`household_id`);--> statement-breakpoint
CREATE INDEX `dish_requests_user` ON `dish_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `dish_requests_dish` ON `dish_requests` (`dish_id`);--> statement-breakpoint
DROP INDEX `users_household`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_household_id` ON `users` (`household_id`,`id`);