CREATE TABLE `agent_file_history` (
	`agent_id` text NOT NULL,
	`agent_role` text NOT NULL,
	`lead_id` text NOT NULL,
	`file_path` text NOT NULL,
	`first_touched_at` text DEFAULT (datetime('now')),
	`last_touched_at` text DEFAULT (datetime('now')),
	`touch_count` integer DEFAULT 1,
	PRIMARY KEY(`agent_id`, `lead_id`, `file_path`)
);
--> statement-breakpoint
CREATE INDEX `idx_file_history_file` ON `agent_file_history` (`file_path`,`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_file_history_agent` ON `agent_file_history` (`agent_id`,`lead_id`);