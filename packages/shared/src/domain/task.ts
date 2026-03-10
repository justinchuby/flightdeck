import { z } from 'zod';

// ── DAG Task ──────────────────────────────────────────────────────

export const DagTaskStatusSchema = z.enum([
  'pending', 'ready', 'running', 'in_review', 'done', 'failed', 'blocked', 'paused', 'skipped',
]);
export type DagTaskStatus = z.infer<typeof DagTaskStatusSchema>;

export const DagTaskSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  projectId: z.string().optional(),
  role: z.string(),
  title: z.string().optional(),
  description: z.string(),
  files: z.array(z.string()),
  dependsOn: z.array(z.string()),
  dagStatus: DagTaskStatusSchema,
  priority: z.number(),
  model: z.string().optional(),
  assignedAgentId: z.string().optional(),
  failureReason: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  archivedAt: z.string().optional(),
  overriddenBy: z.string().optional(),
});
export type DagTask = z.infer<typeof DagTaskSchema>;
