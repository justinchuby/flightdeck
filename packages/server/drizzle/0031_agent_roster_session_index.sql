-- Add session_id index to agent_roster for cross-session filtering
CREATE INDEX IF NOT EXISTS `idx_agent_roster_session` ON `agent_roster` (`session_id`);
