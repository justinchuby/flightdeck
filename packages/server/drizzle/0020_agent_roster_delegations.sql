CREATE TABLE `agent_roster` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL DEFAULT 'idle',
	`session_id` text,
	`project_id` text,
	`created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	`updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	`last_task_summary` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_roster_status` ON `agent_roster` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_agent_roster_project` ON `agent_roster` (`project_id`);
--> statement-breakpoint
CREATE TABLE `active_delegations` (
	`delegation_id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task` text NOT NULL,
	`context` text,
	`dag_task_id` text,
	`status` text NOT NULL DEFAULT 'active',
	`created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	`completed_at` text,
	`result` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_roster`(`agent_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ad_agent` ON `active_delegations` (`agent_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_ad_status` ON `active_delegations` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_ad_dag_task` ON `active_delegations` (`dag_task_id`);
