import { z } from 'zod';

// ── Alert ─────────────────────────────────────────────────────────

export const AlertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertActionSchema = z.object({
  label: z.string(),
  description: z.string(),
  actionType: z.enum(['api_call', 'dismiss']),
  endpoint: z.string(),
  method: z.enum(['POST', 'DELETE']),
  body: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().optional(),
});
export type AlertAction = z.infer<typeof AlertActionSchema>;

export const AlertSchema = z.object({
  id: z.number(),
  type: z.string(),
  severity: AlertSeveritySchema,
  message: z.string(),
  timestamp: z.string(),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
  actions: z.array(AlertActionSchema).optional(),
});
export type Alert = z.infer<typeof AlertSchema>;
