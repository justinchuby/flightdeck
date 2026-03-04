/**
 * Zod schemas for all ACP command payloads.
 *
 * Each command with a JSON payload has a corresponding schema here.
 * Use parseCommandPayload() to parse + validate in one step.
 */
import { z } from 'zod';
import type { Agent } from '../Agent.js';
import { logger } from '../../utils/logger.js';

// Size limits to prevent memory abuse via oversized payloads
const MAX_CONTENT_LENGTH = 50_000;
const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 200;
const MAX_TASK_TEXT_LENGTH = 50_000;
const MAX_ARRAY_LENGTH = 500;
const MAX_MEMBERS_LENGTH = 100;

// ── Comm Commands ────────────────────────────────────────────────────

export const agentMessageSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID or role)' }).min(1, 'Missing required field "to" (agent ID or role)').max(MAX_ID_LENGTH, `"to" too long (max ${MAX_ID_LENGTH})`),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`),
});

export const interruptSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID or role)' }).min(1, 'Missing required field "to" (agent ID or role)').max(MAX_ID_LENGTH, `"to" too long (max ${MAX_ID_LENGTH})`),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`),
});

export const broadcastSchema = z.object({
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`),
});

export const createGroupSchema = z.object({
  name: z.string({ message: 'Missing required field "name"' }).min(1, 'Missing required field "name"').max(MAX_NAME_LENGTH, `"name" too long (max ${MAX_NAME_LENGTH})`),
  members: z.array(z.string()).max(MAX_MEMBERS_LENGTH, `"members" too many (max ${MAX_MEMBERS_LENGTH})`).optional(),
  roles: z.array(z.string()).max(MAX_MEMBERS_LENGTH, `"roles" too many (max ${MAX_MEMBERS_LENGTH})`).optional(),
}).refine(
  (data) => (data.members && data.members.length > 0) || (data.roles && data.roles.length > 0),
  { message: 'Requires either "members" (array of agent IDs) or "roles" (array of role names)' },
);

export const addToGroupSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`),
  members: z.array(z.string()).min(1, 'Missing required field "members" (array of agent IDs)').max(MAX_MEMBERS_LENGTH, `"members" too many (max ${MAX_MEMBERS_LENGTH})`),
});

export const removeFromGroupSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`),
  members: z.array(z.string()).min(1, 'Missing required field "members" (array of agent IDs)').max(MAX_MEMBERS_LENGTH, `"members" too many (max ${MAX_MEMBERS_LENGTH})`),
});

export const groupMessageSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`),
});

// ── Agent Commands ───────────────────────────────────────────────────

export const createAgentSchema = z.object({
  role: z.string({ message: 'Missing required field "role"' }).min(1, 'Missing required field "role"').max(MAX_NAME_LENGTH, `"role" too long (max ${MAX_NAME_LENGTH})`),
  task: z.string().max(MAX_TASK_TEXT_LENGTH, `"task" too long (max ${MAX_TASK_TEXT_LENGTH})`).optional(),
  model: z.string().max(MAX_NAME_LENGTH).optional(),
  context: z.string().max(MAX_CONTENT_LENGTH, `"context" too long (max ${MAX_CONTENT_LENGTH})`).optional(),
  dagTaskId: z.string().max(MAX_ID_LENGTH).optional(),
  dependsOn: z.array(z.string().max(MAX_ID_LENGTH)).max(20).optional(),
  name: z.string().max(MAX_NAME_LENGTH).optional(),
  sessionId: z.string().max(MAX_ID_LENGTH).optional(),
});

export const delegateSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID)' }).min(1, 'Missing required field "to" (agent ID)').max(MAX_ID_LENGTH),
  task: z.string({ message: 'Missing required field "task"' }).min(1, 'Missing required field "task"').max(MAX_TASK_TEXT_LENGTH, `"task" too long (max ${MAX_TASK_TEXT_LENGTH})`),
  context: z.string().max(MAX_CONTENT_LENGTH, `"context" too long (max ${MAX_CONTENT_LENGTH})`).optional(),
  dagTaskId: z.string().max(MAX_ID_LENGTH).optional(),
  dependsOn: z.array(z.string().max(MAX_ID_LENGTH)).max(20).optional(),
});

export const terminateAgentSchema = z.object({
  id: z.string({ message: 'Missing required field "id" (agent ID)' }).min(1, 'Missing required field "id" (agent ID)').max(MAX_ID_LENGTH),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional(),
});

export const cancelDelegationSchema = z.object({
  agentId: z.string().max(MAX_ID_LENGTH).optional(),
  delegationId: z.string().max(MAX_ID_LENGTH).optional(),
}).refine(
  (data) => data.agentId || data.delegationId,
  { message: 'requires either "agentId" or "delegationId"' },
);

// ── Coordination Commands ────────────────────────────────────────────

export const lockFileSchema = z.object({
  filePath: z.string({ message: 'Missing required field "filePath"' }).min(1, 'Missing required field "filePath"').max(500, '"filePath" too long (max 500)'),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional(),
});

export const unlockFileSchema = z.object({
  filePath: z.string({ message: 'Missing required field "filePath"' }).min(1, 'Missing required field "filePath"').max(500, '"filePath" too long (max 500)'),
});

export const activitySchema = z.object({
  action: z.string().max(MAX_NAME_LENGTH).optional(),
  actionType: z.string().max(MAX_NAME_LENGTH).optional(),
  summary: z.string().max(MAX_CONTENT_LENGTH).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const decisionSchema = z.object({
  title: z.string({ message: 'Missing required field "title"' }).min(1, 'Missing required field "title"').max(MAX_NAME_LENGTH, `"title" too long (max ${MAX_NAME_LENGTH})`),
  rationale: z.string().max(MAX_CONTENT_LENGTH).optional(),
  needsConfirmation: z.boolean().optional(),
});

export const commitSchema = z.object({
  message: z.string().max(MAX_CONTENT_LENGTH).optional(),
  files: z.array(z.string()).max(MAX_ARRAY_LENGTH, `"files" too many (max ${MAX_ARRAY_LENGTH})`).optional(),
});

export const progressSchema = z.object({
  summary: z.string().max(MAX_CONTENT_LENGTH, `"summary" too long (max ${MAX_CONTENT_LENGTH})`).optional(),
  percent: z.union([z.number(), z.string()]).transform((val) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num;
  }).pipe(z.number().min(0, 'Percent must be at least 0').max(100, 'Percent must be at most 100')).optional(),
  status: z.string().max(MAX_NAME_LENGTH).optional(),
});

// ── System Commands ──────────────────────────────────────────────────

export const requestLimitChangeSchema = z.object({
  limit: z.union([z.number(), z.string()]).transform((val) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    return num;
  }).pipe(z.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100')),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional(),
});

// ── Timer Commands ───────────────────────────────────────────────────

/** Parse a duration value to seconds. Accepts: number, numeric string, or human-readable (e.g. '30s', '5m', '2h', '1d'). */
function parseDuration(val: number | string): number {
  if (typeof val === 'number') return val;
  const str = val.trim().toLowerCase();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?$/);
  if (!match) return NaN;
  const num = parseFloat(match[1]);
  const unit = match[2] ?? 's';
  if (unit.startsWith('d')) return num * 86400;
  if (unit.startsWith('h')) return num * 3600;
  if (unit.startsWith('m')) return num * 60;
  return num; // seconds
}

export const setTimerSchema = z.object({
  label: z.string({ message: 'Missing required field "label"' }).min(1, 'Missing required field "label"').max(MAX_NAME_LENGTH, `"label" too long (max ${MAX_NAME_LENGTH})`),
  delay: z.union([z.number(), z.string()]).transform((val) => {
    return parseDuration(val);
  }).pipe(z.number({ message: 'Invalid delay format. Use seconds (300), or durations like "5m", "2h", "1d"' }).min(5, 'Delay must be at least 5 seconds').max(86400, 'Delay must be at most 86400 seconds (24 hours)')),
  message: z.string({ message: 'Missing required field "message"' }).min(1, 'Missing required field "message"').max(MAX_CONTENT_LENGTH, `"message" too long (max ${MAX_CONTENT_LENGTH})`),
  repeat: z.boolean().optional(),
});

export const cancelTimerSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  name: z.string().max(MAX_NAME_LENGTH).optional(),
}).refine(
  (data) => data.id || data.name,
  { message: 'Requires either "id" (timer ID) or "name" (timer label)' },
);

// ── Deferred Commands ────────────────────────────────────────────────

export const deferIssueSchema = z.object({
  description: z.string({ message: 'Missing required field "description"' }).min(1, 'Missing required field "description"').max(MAX_CONTENT_LENGTH, `"description" too long (max ${MAX_CONTENT_LENGTH})`),
  severity: z.string().max(MAX_NAME_LENGTH).optional(),
  sourceFile: z.string().max(500).optional(),
  file: z.string().max(500).optional(),
});

export const resolveDeferredSchema = z.object({
  id: z.number({ message: 'Missing required field "id" (number)' }),
  dismiss: z.boolean().optional(),
});

export const queryDeferredSchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed'], { message: '"status" must be one of: open, resolved, dismissed' }).optional(),
});

// ── Capability Commands ──────────────────────────────────────────────

export const acquireCapabilitySchema = z.object({
  capability: z.string({ message: 'Missing required field "capability"' }).min(1, 'Missing required field "capability"').max(MAX_NAME_LENGTH, `"capability" too long (max ${MAX_NAME_LENGTH})`),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional(),
});

export const releaseCapabilitySchema = z.object({
  capability: z.string({ message: 'Missing required field "capability"' }).min(1, 'Missing required field "capability"').max(MAX_NAME_LENGTH, `"capability" too long (max ${MAX_NAME_LENGTH})`),
});

// ── Direct Message Commands ──────────────────────────────────────────

export const directMessageSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID)' }).min(1, 'Missing required field "to" (agent ID)').max(MAX_ID_LENGTH),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`),
});

// ── Reaction Commands ────────────────────────────────────────────────

export const reactSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`),
  emoji: z.string({ message: 'Missing required field "emoji"' }).min(1, 'Missing required field "emoji"').max(8, '"emoji" too long (max 8 chars)'),
  messageId: z.string().max(MAX_ID_LENGTH).optional(),
});

// ── Template Commands ────────────────────────────────────────────────

export const applyTemplateSchema = z.object({
  template: z.string({ message: 'Missing required field "template"' }).min(1, 'Missing required field "template"').max(MAX_NAME_LENGTH, `"template" too long (max ${MAX_NAME_LENGTH})`),
  overrides: z.record(z.string(), z.object({
    title: z.string().max(MAX_NAME_LENGTH).optional(),
    role: z.string().max(MAX_NAME_LENGTH).optional(),
  })).optional(),
});

export const decomposeTaskSchema = z.object({
  task: z.string({ message: 'Missing required field "task"' }).min(1, 'Missing required field "task"').max(MAX_TASK_TEXT_LENGTH, `"task" too long (max ${MAX_TASK_TEXT_LENGTH})`),
});

// ── Task Commands ────────────────────────────────────────────────────

const dagTaskInputSchema = z.object({
  id: z.string({ message: 'Missing required field "id"' }).trim().min(1, 'Missing required field "id"').max(100, 'id too long (max 100 chars)'),
  role: z.string({ message: 'Missing required field "role"' }).trim().min(1, 'Missing required field "role"').max(MAX_NAME_LENGTH, `"role" too long (max ${MAX_NAME_LENGTH})`),
  description: z.string().max(MAX_CONTENT_LENGTH, `"description" too long (max ${MAX_CONTENT_LENGTH})`).optional(),
  dependsOn: z.array(z.string()).max(MAX_MEMBERS_LENGTH, `"dependsOn" too many (max ${MAX_MEMBERS_LENGTH})`).optional(),
  files: z.array(z.string()).max(MAX_ARRAY_LENGTH, `"files" too many (max ${MAX_ARRAY_LENGTH})`).optional(),
  status: z.string().max(MAX_NAME_LENGTH).optional(),
  priority: z.number().optional(),
});

export const declareTasksSchema = z.object({
  tasks: z.array(dagTaskInputSchema).min(1, 'The "tasks" array must not be empty').max(MAX_ARRAY_LENGTH, `"tasks" too many (max ${MAX_ARRAY_LENGTH})`),
});

export const addTaskSchema = dagTaskInputSchema;

export const taskIdSchema = z.object({
  id: z.string({ message: 'Missing required field "id"' }).min(1, 'Missing required field "id"').max(MAX_ID_LENGTH),
});

export const completeTaskSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  summary: z.string().max(MAX_CONTENT_LENGTH, `"summary" too long (max ${MAX_CONTENT_LENGTH})`).optional(),
  status: z.string().max(MAX_NAME_LENGTH).optional(),
  output: z.string().max(MAX_CONTENT_LENGTH, `"output" too long (max ${MAX_CONTENT_LENGTH})`).optional(),
});

export const addDependencySchema = z.object({
  taskId: z.string({ message: 'Missing required field "taskId"' }).min(1, 'Missing required field "taskId"').max(MAX_ID_LENGTH),
  dependsOn: z.array(z.string().max(MAX_ID_LENGTH)).min(1, '"dependsOn" must have at least one task ID').max(20, '"dependsOn" max 20 entries'),
});

export const assignTaskSchema = z.object({
  taskId: z.string({ message: 'Missing required field "taskId"' }).min(1, 'Missing required field "taskId"').max(MAX_ID_LENGTH),
  agentId: z.string({ message: 'Missing required field "agentId"' }).min(1, 'Missing required field "agentId"').max(MAX_ID_LENGTH),
});

// ── Validation helper ────────────────────────────────────────────────

/**
 * Parse a JSON string and validate it against a Zod schema.
 * On failure, sends a clear error message to the agent and returns null.
 */
export function parseCommandPayload<T>(
  agent: Agent,
  jsonString: string,
  schema: z.ZodType<T>,
  commandName: string,
): T | null {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    agent.sendMessage(`[System] ${commandName} error: invalid JSON payload. Check syntax and try again.`);
    return null;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstError = result.error.issues[0];
    const message = firstError?.message || 'Invalid payload';
    // Include path for nested errors (e.g., "tasks[1].role")
    const path = firstError?.path?.length
      ? firstError.path.map((p, i) => typeof p === 'number' ? `[${p}]` : (i > 0 ? `.${String(p)}` : String(p))).join('')
      : '';
    const pathPrefix = path ? ` at "${path}"` : '';
    agent.sendMessage(`[System] ${commandName} validation error${pathPrefix}: ${message}`);
    logger.debug('command', `${commandName} validation failed`, {
      agentId: agent.id,
      errors: result.error.issues.map(i => ({ path: i.path, message: i.message })),
    });
    return null;
  }

  return result.data;
}
