ALTER TABLE `products` ADD `food_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `pack_quantity` real;--> statement-breakpoint
ALTER TABLE `products` ADD `regular_price` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `min_packs` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `loyalty_required` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `valid_from` text;--> statement-breakpoint
ALTER TABLE `products` ADD `valid_to` text;--> statement-breakpoint
ALTER TABLE `products` ADD `price_kind` text DEFAULT 'catalog' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `region_verified` integer DEFAULT 0 NOT NULL;