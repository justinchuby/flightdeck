-- Add provider column to agent_roster for per-agent provider tracking
ALTER TABLE `agent_roster` ADD COLUMN `provider` text;
--> statement-breakpoint
-- Backfill: all existing agents were copilot-based
UPDATE `agent_roster` SET `provider` = 'copilot' WHERE `provider` IS NULL;
