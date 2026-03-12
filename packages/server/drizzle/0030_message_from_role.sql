-- Add from_role column to messages for external (agent DM) message persistence
ALTER TABLE `messages` ADD COLUMN `from_role` text;
