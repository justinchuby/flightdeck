-- Originally added project_id to timers, but timers are session-scoped (leadId)
-- not project-scoped. The lead_id column (from 0015) is the correct session identity.
-- This migration is intentionally a no-op (project_id column removed before merge).
SELECT 1;
