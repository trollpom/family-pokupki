CREATE TABLE `catalog_jobs` (
	`source_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
