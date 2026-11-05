ALTER TABLE `items` ADD `photo_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `items_photo_key` ON `items` (`photo_key`);