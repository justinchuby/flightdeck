import { z } from 'zod';

// ── File Lock ─────────────────────────────────────────────────────

export const FileLockSchema = z.object({
  filePath: z.string(),
  agentId: z.string(),
  agentRole: z.string(),
  projectId: z.string(),
  reason: z.string(),
  acquiredAt: z.string(),
  expiresAt: z.string(),
});
export type FileLock = z.infer<typeof FileLockSchema>;
