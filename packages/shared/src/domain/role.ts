import { z } from 'zod';

// ── Role ──────────────────────────────────────────────────────────

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  color: z.string(),
  icon: z.string(),
  builtIn: z.boolean(),
  model: z.string().optional(),
  receivesStatusUpdates: z.boolean().optional(),
});
export type Role = z.infer<typeof RoleSchema>;
