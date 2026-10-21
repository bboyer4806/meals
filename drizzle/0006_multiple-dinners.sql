DROP INDEX `dinners_household_date`;--> statement-breakpoint
ALTER TABLE `dinners` ADD `label` text;--> statement-breakpoint
CREATE INDEX `dinners_household_date` ON `dinners` (`household_id`,`date`);