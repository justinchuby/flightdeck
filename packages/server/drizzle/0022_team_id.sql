-- Add team_id to agent_roster, active_delegations, and dag_tasks for multi-team support.
-- Default value 'default' maintains backward compatibility with existing single-team data.

ALTER TABLE `agent_roster` ADD COLUMN `team_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
CREATE INDEX `idx_agent_roster_project_team` ON `agent_roster` (`project_id`, `team_id`);
--> statement-breakpoint
CREATE INDEX `idx_agent_roster_team` ON `agent_roster` (`team_id`);
--> statement-breakpoint
ALTER TABLE `active_delegations` ADD COLUMN `team_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
CREATE INDEX `idx_ad_team` ON `active_delegations` (`team_id`);
--> statement-breakpoint
ALTER TABLE `dag_tasks` ADD COLUMN `team_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
CREATE INDEX `idx_dag_tasks_team` ON `dag_tasks` (`team_id`);
--> statement-breakpoint
CREATE INDEX `idx_dag_tasks_id_team` ON `dag_tasks` (`id`, `team_id`);
