import { z } from 'zod';

// ── Activity ──────────────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  'file_edit',
  'file_read',
  'decision_made',
  'task_started',
  'task_completed',
  'sub_agent_spawned',
  'agent_terminated',
  'lock_acquired',
  'lock_released',
  'lock_denied',
  'message_sent',
  'delegated',
  'delegation_cancelled',
  'status_change',
  'heartbeat_halted',
  'limit_change_requested',
  'deferred_issue',
  'group_message',
  'agent_interrupted',
  'error',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActivityEntrySchema = z.object({
  id: z.number(),
  agentId: z.string(),
  agentRole: z.string(),
  actionType: ActionTypeSchema,
  summary: z.string(),
  details: z.record(z.string(), z.any()),
  timestamp: z.string(),
  projectId: z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
