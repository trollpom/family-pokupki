CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`hash` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'шт' NOT NULL,
	`price` integer,
	`category` text DEFAULT 'Продукты' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`bought` integer DEFAULT 0 NOT NULL,
	`bought_at` text,
	`important` integer DEFAULT 0 NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`barcode` text,
	`store` text,
	`source_url` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_list` ON `items` (`list_id`);--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`group_id` text,
	`name` text NOT NULL,
	`icon` text DEFAULT '🛒' NOT NULL,
	`budget` integer DEFAULT 0 NOT NULL,
	`date` text,
	`favorite` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`example` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lists_owner` ON `lists` (`owner`);--> statement-breakpoint
CREATE INDEX `lists_group` ON `lists` (`group_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_user` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`source_id` text NOT NULL,
	`store` text NOT NULL,
	`city` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`unit` text DEFAULT 'шт' NOT NULL,
	`barcode` text,
	`image` text,
	`url` text NOT NULL,
	`category` text DEFAULT 'Продукты' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_owner` ON `products` (`owner`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`city` text DEFAULT 'Москва' NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`recipe_favorites` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`store` text NOT NULL,
	`city` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_attempt` text,
	`last_success` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`message` text DEFAULT 'Ожидает обновления' NOT NULL
);
