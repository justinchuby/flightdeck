CREATE TABLE `deferred_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` text NOT NULL,
	`reviewer_agent_id` text NOT NULL,
	`reviewer_role` text NOT NULL,
	`severity` text DEFAULT 'P1' NOT NULL,
	`description` text NOT NULL,
	`source_file` text DEFAULT '',
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_deferred_issues_lead` ON `deferred_issues` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_deferred_issues_status` ON `deferred_issues` (`status`);--> statement-breakpoint
ALTER TABLE `chat_groups` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `decisions` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `idx_decisions_project_id` ON `decisions` (`project_id`);