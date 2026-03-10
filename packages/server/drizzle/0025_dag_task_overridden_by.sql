-- Add overridden_by column to track when one task supersedes another.
-- Nullable TEXT: when set, contains the ID of the task that overrides this one.

ALTER TABLE `dag_tasks` ADD COLUMN `overridden_by` text;
