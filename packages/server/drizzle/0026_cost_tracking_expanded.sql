ALTER TABLE `task_cost_records` ADD COLUMN `cache_read_tokens` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `task_cost_records` ADD COLUMN `cache_write_tokens` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `task_cost_records` ADD COLUMN `cost_usd` real DEFAULT 0;
