import { z } from 'zod';

// ── Delegation ────────────────────────────────────────────────────

export const DelegationStatusSchema = z.enum([
  'active', 'completed', 'failed', 'cancelled', 'terminated',
]);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

export const DelegationSchema = z.object({
  id: z.string(),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  toRole: z.string(),
  task: z.string(),
  context: z.string().optional(),
  status: DelegationStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().optional(),
  result: z.string().optional(),
});
export type Delegation = z.infer<typeof DelegationSchema>;
