CREATE TABLE `dish_ingredients` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`dish_id` integer NOT NULL,
	`position` integer NOT NULL,
	`section` text,
	`amount` real,
	`unit` text,
	`item_id` integer NOT NULL,
	`prep_note` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`item_id`) REFERENCES `items`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dish_ingredients_amount" CHECK("dish_ingredients"."amount" > 0),
	CONSTRAINT "dish_ingredients_unit" CHECK("dish_ingredients"."unit" is null or "dish_ingredients"."amount" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dish_ingredients_dish_position` ON `dish_ingredients` (`dish_id`,`position`);--> statement-breakpoint
CREATE INDEX `dish_ingredients_item` ON `dish_ingredients` (`item_id`);--> statement-breakpoint
CREATE TABLE `dish_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`dish_id` integer NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dish_tags_dish_tag` ON `dish_tags` (`dish_id`,lower("tag"));--> statement-breakpoint
CREATE INDEX `dish_tags_household` ON `dish_tags` (`household_id`);--> statement-breakpoint
CREATE TABLE `dishes` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`servings` integer NOT NULL,
	`prep_minutes` integer,
	`cook_minutes` integer,
	`steps` text,
	`notes` text,
	`source` text,
	`photo_key` text,
	`calories` real,
	`protein_g` real,
	`carbs_g` real,
	`fat_g` real,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dishes_servings" CHECK("dishes"."servings" >= 1),
	CONSTRAINT "dishes_prep_minutes" CHECK("dishes"."prep_minutes" >= 0),
	CONSTRAINT "dishes_cook_minutes" CHECK("dishes"."cook_minutes" >= 0),
	CONSTRAINT "dishes_nutrition" CHECK("dishes"."calories" >= 0 and "dishes"."protein_g" >= 0 and "dishes"."carbs_g" >= 0 and "dishes"."fat_g" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dishes_household_name` ON `dishes` (`household_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `dishes_photo_key` ON `dishes` (`photo_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `dishes_household_id` ON `dishes` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `pantry_checklists` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`dish_id` integer,
	`servings` integer,
	`start_date` text,
	`end_date` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`dish_id`) REFERENCES `dishes`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pantry_checklists_source" CHECK(("pantry_checklists"."dish_id" is not null and "pantry_checklists"."servings" is not null and "pantry_checklists"."start_date" is null and "pantry_checklists"."end_date" is null)
				or ("pantry_checklists"."dish_id" is null and "pantry_checklists"."servings" is null and "pantry_checklists"."start_date" is not null and "pantry_checklists"."end_date" is not null)),
	CONSTRAINT "pantry_checklists_servings" CHECK("pantry_checklists"."servings" >= 1),
	CONSTRAINT "pantry_checklists_dates" CHECK("pantry_checklists"."start_date" <= "pantry_checklists"."end_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_checklists_household_id_unique` ON `pantry_checklists` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_checklists_household_id` ON `pantry_checklists` (`household_id`,`id`);--> statement-breakpoint
CREATE TABLE `pantry_marks` (
	`id` integer PRIMARY KEY NOT NULL,
	`household_id` integer NOT NULL,
	`checklist_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`state` text NOT NULL,
	`need_id` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`checklist_id`) REFERENCES `pantry_checklists`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`,`item_id`) REFERENCES `items`(`household_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`household_id`,`need_id`) REFERENCES `grocery_needs`(`household_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pantry_marks_state" CHECK("pantry_marks"."state" in ('have', 'need')),
	CONSTRAINT "pantry_marks_need_line" CHECK(("pantry_marks"."state" = 'need') = ("pantry_marks"."need_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_marks_checklist_item` ON `pantry_marks` (`checklist_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `pantry_marks_need` ON `pantry_marks` (`need_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `always_have` integer DEFAULT false NOT NULL;