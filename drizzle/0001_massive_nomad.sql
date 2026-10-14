CREATE TABLE `identity_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `identity_platform` ON `identity_aliases` (`platform_id`);