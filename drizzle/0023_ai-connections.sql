CREATE TABLE `ai_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`secret_hash` text,
	`platform` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL,
	`user_id` integer,
	`authorized_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_connections_platform" CHECK("ai_connections"."platform" in ('chatgpt', 'claude')),
	CONSTRAINT "ai_connections_authorized" CHECK(("ai_connections"."user_id" is null) = ("ai_connections"."authorized_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_connections_client_id_unique` ON `ai_connections` (`client_id`);--> statement-breakpoint
CREATE TABLE `ai_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_proposals_status" CHECK("ai_proposals"."status" in ('pending', 'approved', 'rejected', 'failed')),
	CONSTRAINT "ai_proposals_decided" CHECK(("ai_proposals"."status" = 'pending') = ("ai_proposals"."decided_at" is null)),
	CONSTRAINT "ai_proposals_error" CHECK(("ai_proposals"."status" = 'failed') = ("ai_proposals"."error" is not null))
);
--> statement-breakpoint
CREATE INDEX `ai_proposals_connection` ON `ai_proposals` (`connection_id`);--> statement-breakpoint
CREATE TABLE `ai_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer NOT NULL,
	`redirect_uri` text,
	`code_challenge` text,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_tokens_kind" CHECK("ai_tokens"."kind" in ('code', 'access', 'refresh')),
	CONSTRAINT "ai_tokens_code" CHECK(("ai_tokens"."kind" = 'code') = ("ai_tokens"."redirect_uri" is not null and "ai_tokens"."code_challenge" is not null))
);
--> statement-breakpoint
CREATE INDEX `ai_tokens_connection` ON `ai_tokens` (`connection_id`);