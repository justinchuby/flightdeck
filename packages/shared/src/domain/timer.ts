import { z } from 'zod';

// ── Timer ─────────────────────────────────────────────────────────

export const TimerStatusSchema = z.enum(['pending', 'fired', 'cancelled']);
export type TimerStatus = z.infer<typeof TimerStatusSchema>;

export const TimerSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentRole: z.string(),
  leadId: z.string().nullable(),
  label: z.string(),
  message: z.string(),
  delaySeconds: z.number(),
  fireAt: z.number(), // epoch ms
  createdAt: z.string(),
  status: TimerStatusSchema,
  repeat: z.boolean(),
});
export type Timer = z.infer<typeof TimerSchema>;
