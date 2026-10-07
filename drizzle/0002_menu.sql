CREATE TABLE `dinner_dishes` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`dinner_id` integer NOT NULL,
	`dish_id` integer NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`dinner_id`) REFERENCES `dinners`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dinner_dishes_role" CHECK("dinner_dishes"."role" in ('main', 'side', 'dessert', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dinner_dishes_dinner_dish` ON `dinner_dishes` (`dinner_id`,`dish_id`);--> statement-breakpoint
CREATE INDEX `dinner_dishes_dish` ON `dinner_dishes` (`dish_id`);--> statement-breakpoint
CREATE TABLE `dinners` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`note` text,
	`servings` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dinners_type" CHECK("dinners"."type" in ('cook', 'eat_out', 'going', 'leftovers')),
	CONSTRAINT "dinners_servings" CHECK("dinners"."servings" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dinners_household_date` ON `dinners` (`household_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `dinners_household_id` ON `dinners` (`household_id`,`id`);