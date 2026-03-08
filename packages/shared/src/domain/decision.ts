import { z } from 'zod';

// ── Decision ──────────────────────────────────────────────────────

export const DecisionStatusSchema = z.enum([
  'recorded', 'confirmed', 'rejected', 'dismissed',
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DECISION_CATEGORIES = [
  'style', 'architecture', 'tool_access', 'dependency', 'testing', 'general',
] as const;

export const DecisionCategorySchema = z.enum(DECISION_CATEGORIES);
export type DecisionCategory = z.infer<typeof DecisionCategorySchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentRole: z.string(),
  leadId: z.string().nullable(),
  projectId: z.string().nullable(),
  title: z.string(),
  rationale: z.string(),
  needsConfirmation: z.boolean(),
  status: DecisionStatusSchema,
  autoApproved: z.boolean(),
  confirmedAt: z.string().nullable(),
  timestamp: z.string(),
  category: DecisionCategorySchema,
});
export type Decision = z.infer<typeof DecisionSchema>;
