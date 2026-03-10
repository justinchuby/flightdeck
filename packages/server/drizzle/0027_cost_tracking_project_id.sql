ALTER TABLE `task_cost_records` ADD COLUMN `project_id` text;--> statement-breakpoint
CREATE INDEX `idx_task_cost_project` ON `task_cost_records` (`project_id`);
