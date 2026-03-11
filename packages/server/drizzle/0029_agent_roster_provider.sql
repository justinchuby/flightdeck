-- Add provider column to agent_roster for per-agent provider tracking
ALTER TABLE agent_roster ADD COLUMN provider TEXT;
