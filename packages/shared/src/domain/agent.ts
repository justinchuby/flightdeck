import { z } from 'zod';

// ── Agent Status ──────────────────────────────────────────────────

export const AgentStatusSchema = z.enum([
  'creating', 'running', 'idle', 'completed', 'failed', 'terminated',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
