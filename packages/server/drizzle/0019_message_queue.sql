CREATE TABLE `message_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_agent_id` text NOT NULL,
	`source_agent_id` text,
	`message_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL DEFAULT 'queued',
	`attempts` integer NOT NULL DEFAULT 0,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	`delivered_at` text,
	`project_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_mq_target_status` ON `message_queue` (`target_agent_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_mq_project` ON `message_queue` (`project_id`);
