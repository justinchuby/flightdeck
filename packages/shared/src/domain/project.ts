import { z } from 'zod';

// ── Project ───────────────────────────────────────────────────────

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  cwd: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ── Project Session ───────────────────────────────────────────────

export const ProjectSessionSchema = z.object({
  id: z.number(),
  projectId: z.string(),
  leadId: z.string(),
  sessionId: z.string().nullable(),
  role: z.string().nullable(),
  task: z.string().nullable(),
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type ProjectSession = z.infer<typeof ProjectSessionSchema>;
