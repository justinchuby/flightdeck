ALTER TABLE `dag_tasks` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `idx_dag_tasks_project` ON `dag_tasks` (`project_id`);
