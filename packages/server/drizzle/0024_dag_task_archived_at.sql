-- Add archived_at column for soft-delete on RESET_DAG.
-- When set, the task is hidden from active views but preserved for history.

ALTER TABLE `dag_tasks` ADD COLUMN `archived_at` text;
