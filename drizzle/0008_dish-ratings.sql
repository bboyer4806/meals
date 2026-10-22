CREATE TABLE `dish_ratings` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`dish_id` integer NOT NULL,
	`user_id` integer,
	`stars` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dish_ratings_stars" CHECK("dish_ratings"."stars" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dish_ratings_dish_user` ON `dish_ratings` (`dish_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `dish_ratings_household` ON `dish_ratings` (`household_id`);--> statement-breakpoint
CREATE INDEX `dish_ratings_user` ON `dish_ratings` (`user_id`);