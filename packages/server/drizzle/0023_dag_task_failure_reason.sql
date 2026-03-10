-- Add failure_reason column to dag_tasks for actionable failed-task cards.
-- Populated when a task fails (e.g., agent exit code, error message).

ALTER TABLE `dag_tasks` ADD COLUMN `failure_reason` text;
