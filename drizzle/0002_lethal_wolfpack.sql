CREATE TABLE `ai_credentials` (
	`owner` text PRIMARY KEY NOT NULL,
	`encrypted_key` text NOT NULL,
	`model` text DEFAULT 'deepseek-flash' NOT NULL,
	`last_request_at` text,
	`checked_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_requests_owner` ON `ai_requests` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `family_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meal_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`list_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `meal_plans_owner` ON `meal_plans` (`owner`);--> statement-breakpoint
CREATE TABLE `price_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`food_id` text NOT NULL,
	`store` text NOT NULL,
	`city` text NOT NULL,
	`name` text NOT NULL,
	`pack_quantity` real NOT NULL,
	`price` integer NOT NULL,
	`regular_price` integer,
	`min_packs` integer DEFAULT 1 NOT NULL,
	`loyalty_required` integer DEFAULT 0 NOT NULL,
	`composition_confirmed` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`url` text,
	`kind` text DEFAULT 'manual' NOT NULL,
	`verified_at` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_offers_owner` ON `price_offers` (`owner`);