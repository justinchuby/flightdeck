CREATE TABLE `collective_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`last_used_at` text DEFAULT (datetime('now')),
	`use_count` integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX `idx_collective_memory_category` ON `collective_memory` (`category`);--> statement-breakpoint
CREATE INDEX `idx_collective_memory_key` ON `collective_memory` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collective_memory_cat_key` ON `collective_memory` (`category`,`key`);