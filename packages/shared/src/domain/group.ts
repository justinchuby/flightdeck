import { z } from 'zod';

// ── Chat Group ────────────────────────────────────────────────────

export const ChatGroupSchema = z.object({
  name: z.string(),
  leadId: z.string(),
  projectId: z.string().optional(),
  archived: z.boolean().optional(),
  memberIds: z.array(z.string()),
  createdAt: z.string(),
});
export type ChatGroup = z.infer<typeof ChatGroupSchema>;

// ── Group Message ─────────────────────────────────────────────────

export const GroupMessageSchema = z.object({
  id: z.string(),
  groupName: z.string(),
  leadId: z.string(),
  fromAgentId: z.string(),
  fromRole: z.string(),
  content: z.string(),
  reactions: z.record(z.string(), z.array(z.string())),
  timestamp: z.string(),
});
export type GroupMessage = z.infer<typeof GroupMessageSchema>;
