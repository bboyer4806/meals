DROP INDEX `invites_email_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_start_email` ON `invites` (`email`) WHERE "invites"."household_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_household` ON `invites` (`email`,`household_id`);