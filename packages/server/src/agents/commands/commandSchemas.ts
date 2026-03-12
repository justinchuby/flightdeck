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
  to: z.string({ message: 'Missing required field "to" (agent ID or role)' }).min(1, 'Missing required field "to" (agent ID or role)').max(MAX_ID_LENGTH, `"to" too long (max ${MAX_ID_LENGTH})`).describe('Target agent ID or role name'),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`).describe('Message content'),
});

export const interruptSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID or role)' }).min(1, 'Missing required field "to" (agent ID or role)').max(MAX_ID_LENGTH, `"to" too long (max ${MAX_ID_LENGTH})`).describe('Target agent ID or role name'),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`).describe('Urgent message content'),
});

export const broadcastSchema = z.object({
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`).describe('Broadcast message content'),
});

export const createGroupSchema = z.object({
  name: z.string({ message: 'Missing required field "name"' }).min(1, 'Missing required field "name"').max(MAX_NAME_LENGTH, `"name" too long (max ${MAX_NAME_LENGTH})`).describe('Group name'),
  members: z.array(z.string()).max(MAX_MEMBERS_LENGTH, `"members" too many (max ${MAX_MEMBERS_LENGTH})`).optional().describe('Array of agent IDs'),
  roles: z.array(z.string()).max(MAX_MEMBERS_LENGTH, `"roles" too many (max ${MAX_MEMBERS_LENGTH})`).optional().describe('Array of role names'),
}).refine(
  (data) => (data.members && data.members.length > 0) || (data.roles && data.roles.length > 0),
  { message: 'Requires either "members" (array of agent IDs) or "roles" (array of role names)' },
);

export const addToGroupSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`).describe('Group name'),
  members: z.array(z.string()).min(1, 'Missing required field "members" (array of agent IDs)').max(MAX_MEMBERS_LENGTH, `"members" too many (max ${MAX_MEMBERS_LENGTH})`).describe('Agent IDs to add'),
});

export const removeFromGroupSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`).describe('Group name'),
  members: z.array(z.string()).min(1, 'Missing required field "members" (array of agent IDs)').max(MAX_MEMBERS_LENGTH, `"members" too many (max ${MAX_MEMBERS_LENGTH})`).describe('Agent IDs to remove'),
});

export const groupMessageSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`).describe('Group name'),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`).describe('Message content'),
});

// ── Agent Commands ───────────────────────────────────────────────────

export const createAgentSchema = z.object({
  role: z.string({ message: 'Missing required field "role"' }).min(1, 'Missing required field "role"').max(MAX_NAME_LENGTH, `"role" too long (max ${MAX_NAME_LENGTH})`).describe('Role ID to assign'),
  task: z.string().max(MAX_TASK_TEXT_LENGTH, `"task" too long (max ${MAX_TASK_TEXT_LENGTH})`).optional().describe('Task to assign'),
  model: z.string().max(MAX_NAME_LENGTH).optional().describe('Model override'),
  provider: z.string().max(MAX_NAME_LENGTH).optional().describe('Provider override (e.g. copilot, claude, gemini, codex)'),
  context: z.string().max(MAX_CONTENT_LENGTH, `"context" too long (max ${MAX_CONTENT_LENGTH})`).optional().describe('Additional context'),
  dagTaskId: z.string().max(MAX_ID_LENGTH).optional().describe('DAG task ID to link'),
  dependsOn: z.array(z.string().max(MAX_ID_LENGTH)).max(20).optional().describe('Task IDs this depends on'),
  name: z.string().max(MAX_NAME_LENGTH).optional().describe('Custom agent name'),
  sessionId: z.string().max(MAX_ID_LENGTH).optional().describe('Session ID to resume'),
});

export const delegateSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID)' }).min(1, 'Missing required field "to" (agent ID)').max(MAX_ID_LENGTH).describe('Target agent ID'),
  task: z.string({ message: 'Missing required field "task"' }).min(1, 'Missing required field "task"').max(MAX_TASK_TEXT_LENGTH, `"task" too long (max ${MAX_TASK_TEXT_LENGTH})`).describe('Task description'),
  context: z.string().max(MAX_CONTENT_LENGTH, `"context" too long (max ${MAX_CONTENT_LENGTH})`).optional().describe('Additional context'),
  dagTaskId: z.string().max(MAX_ID_LENGTH).optional().describe('DAG task ID to link'),
  dependsOn: z.array(z.string().max(MAX_ID_LENGTH)).max(20).optional().describe('Task IDs this depends on'),
});

export const terminateAgentSchema = z.object({
  agentId: z.string({ message: 'Missing required field "agentId"' }).min(1, 'Missing required field "agentId"').max(MAX_ID_LENGTH).describe('Agent ID to terminate'),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Reason for termination'),
});

export const cancelDelegationSchema = z.object({
  agentId: z.string().max(MAX_ID_LENGTH).optional().describe('Agent ID to cancel delegation for'),
  delegationId: z.string().max(MAX_ID_LENGTH).optional().describe('Delegation ID to cancel'),
}).refine(
  (data) => data.agentId || data.delegationId,
  { message: 'requires either "agentId" or "delegationId"' },
);

// ── Coordination Commands ────────────────────────────────────────────

export const lockFileSchema = z.object({
  filePath: z.string({ message: 'Missing required field "filePath"' }).min(1, 'Missing required field "filePath"').max(500, '"filePath" too long (max 500)').describe('Path to lock'),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Why you need this lock'),
});

export const unlockFileSchema = z.object({
  filePath: z.string({ message: 'Missing required field "filePath"' }).min(1, 'Missing required field "filePath"').max(500, '"filePath" too long (max 500)').describe('Path to unlock'),
});

export const activitySchema = z.object({
  actionType: z.string().max(MAX_NAME_LENGTH).optional().describe('Activity type'),
  summary: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Activity summary'),
  details: z.record(z.string(), z.unknown()).optional().describe('Additional details'),
});

export const decisionSchema = z.object({
  title: z.string({ message: 'Missing required field "title"' }).min(1, 'Missing required field "title"').max(MAX_NAME_LENGTH, `"title" too long (max ${MAX_NAME_LENGTH})`).describe('Decision title'),
  rationale: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Reasoning behind the decision'),
  needsConfirmation: z.boolean().optional().describe('Whether human confirmation is needed'),
});

export const commitSchema = z.object({
  message: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Commit message'),
  files: z.array(z.string()).max(MAX_ARRAY_LENGTH, `"files" too many (max ${MAX_ARRAY_LENGTH})`).optional().describe('Specific files to commit'),
});

export const progressSchema = z.object({
  summary: z.string().max(MAX_CONTENT_LENGTH, `"summary" too long (max ${MAX_CONTENT_LENGTH})`).optional().describe('Progress description'),
  percent: z.union([z.number(), z.string()]).transform((val) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num;
  }).pipe(z.number().min(0, 'Percent must be at least 0').max(100, 'Percent must be at most 100')).optional().describe('Completion percentage (0-100)'),
  status: z.string().max(MAX_NAME_LENGTH).optional().describe('Status label'),
});

// ── System Commands ──────────────────────────────────────────────────

export const requestLimitChangeSchema = z.object({
  limit: z.union([z.number(), z.string()]).transform((val) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    return num;
  }).pipe(z.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100')).describe('New concurrency limit (1-100)'),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Reason for the change'),
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
  label: z.string({ message: 'Missing required field "label"' }).min(1, 'Missing required field "label"').max(MAX_NAME_LENGTH, `"label" too long (max ${MAX_NAME_LENGTH})`).describe('Timer label/name'),
  delay: z.union([z.number(), z.string()]).transform((val) => {
    return parseDuration(val);
  }).pipe(z.number({ message: 'Invalid delay format. Use seconds (300), or durations like "5m", "2h", "1d"' }).min(5, 'Delay must be at least 5 seconds').max(86400, 'Delay must be at most 86400 seconds (24 hours)')).describe('Delay in seconds or duration string (e.g. "5m", "2h")'),
  message: z.string({ message: 'Missing required field "message"' }).min(1, 'Missing required field "message"').max(MAX_CONTENT_LENGTH, `"message" too long (max ${MAX_CONTENT_LENGTH})`).describe('Message to deliver when timer fires'),
  repeat: z.boolean().optional().describe('Whether to repeat the timer'),
});

export const cancelTimerSchema = z.object({
  timerId: z.string().max(MAX_ID_LENGTH).optional().describe('Timer ID'),
  label: z.string().max(MAX_NAME_LENGTH).optional().describe('Timer label'),
}).refine(
  (data) => data.timerId || data.label,
  { message: 'Requires either "timerId" (timer ID) or "label" (timer label)' },
);

// ── Capability Commands ──────────────────────────────────────────────

export const acquireCapabilitySchema = z.object({
  capability: z.string({ message: 'Missing required field "capability"' }).min(1, 'Missing required field "capability"').max(MAX_NAME_LENGTH, `"capability" too long (max ${MAX_NAME_LENGTH})`).describe('Capability name'),
  reason: z.string().max(MAX_CONTENT_LENGTH).optional().describe('Why you need this capability'),
});

export const releaseCapabilitySchema = z.object({
  capability: z.string({ message: 'Missing required field "capability"' }).min(1, 'Missing required field "capability"').max(MAX_NAME_LENGTH, `"capability" too long (max ${MAX_NAME_LENGTH})`).describe('Capability name to release'),
});

// ── Direct Message Commands ──────────────────────────────────────────

export const directMessageSchema = z.object({
  to: z.string({ message: 'Missing required field "to" (agent ID)' }).min(1, 'Missing required field "to" (agent ID)').max(MAX_ID_LENGTH).describe('Target agent ID'),
  content: z.string({ message: 'Missing required field "content"' }).min(1, 'Missing required field "content"').max(MAX_CONTENT_LENGTH, `"content" too long (max ${MAX_CONTENT_LENGTH})`).describe('Message content'),
});

// ── Reaction Commands ────────────────────────────────────────────────

export const reactSchema = z.object({
  group: z.string({ message: 'Missing required field "group"' }).min(1, 'Missing required field "group"').max(MAX_NAME_LENGTH, `"group" too long (max ${MAX_NAME_LENGTH})`).describe('Group name'),
  emoji: z.string({ message: 'Missing required field "emoji"' }).min(1, 'Missing required field "emoji"').max(8, '"emoji" too long (max 8 chars)').describe('Emoji reaction'),
  messageId: z.string().max(MAX_ID_LENGTH).optional().describe('Message ID to react to'),
});

// ── Template Commands ────────────────────────────────────────────────

export const applyTemplateSchema = z.object({
  template: z.string({ message: 'Missing required field "template"' }).min(1, 'Missing required field "template"').max(MAX_NAME_LENGTH, `"template" too long (max ${MAX_NAME_LENGTH})`).describe('Template name'),
  overrides: z.record(z.string(), z.object({
    title: z.string().max(MAX_NAME_LENGTH).optional(),
    role: z.string().max(MAX_NAME_LENGTH).optional(),
  })).optional().describe('Per-task overrides'),
});

export const decomposeTaskSchema = z.object({
  task: z.string({ message: 'Missing required field "task"' }).min(1, 'Missing required field "task"').max(MAX_TASK_TEXT_LENGTH, `"task" too long (max ${MAX_TASK_TEXT_LENGTH})`).describe('Task to decompose'),
});

// ── Task Commands ────────────────────────────────────────────────────

const dagTaskInputSchema = z.object({
  taskId: z.string({ message: 'Missing required field "taskId"' }).trim().min(1, 'Missing required field "taskId"').max(100, 'taskId too long (max 100 chars)').describe('Unique task ID'),
  role: z.string({ message: 'Missing required field "role"' }).trim().min(1, 'Missing required field "role"').max(MAX_NAME_LENGTH, `"role" too long (max ${MAX_NAME_LENGTH})`).describe('Role to assign'),
  description: z.string().max(MAX_CONTENT_LENGTH, `"description" too long (max ${MAX_CONTENT_LENGTH})`).optional().describe('Task description'),
  dependsOn: z.array(z.string()).max(MAX_MEMBERS_LENGTH, `"dependsOn" too many (max ${MAX_MEMBERS_LENGTH})`).optional().describe('Task IDs this depends on'),
  files: z.array(z.string()).max(MAX_ARRAY_LENGTH, `"files" too many (max ${MAX_ARRAY_LENGTH})`).optional().describe('Files to lock for this task'),
  status: z.string().max(MAX_NAME_LENGTH).optional().describe('Initial status'),
  priority: z.number().optional().describe('Priority level'),
});

export const declareTasksSchema = z.object({
  tasks: z.array(dagTaskInputSchema).min(1, 'The "tasks" array must not be empty').max(MAX_ARRAY_LENGTH, `"tasks" too many (max ${MAX_ARRAY_LENGTH})`).describe('Array of task definitions'),
});

export const addTaskSchema = dagTaskInputSchema;

export const taskIdSchema = z.object({
  taskId: z.string({ message: 'Missing required field "taskId"' }).min(1, 'Missing required field "taskId"').max(MAX_ID_LENGTH).describe('Task ID'),
});

export const completeTaskSchema = z.object({
  taskId: z.string().max(MAX_ID_LENGTH).optional().describe('Task ID (auto-detected if omitted)'),
  summary: z.string().max(MAX_CONTENT_LENGTH, `"summary" too long (max ${MAX_CONTENT_LENGTH})`).optional().describe('What was accomplished'),
  status: z.string().max(MAX_NAME_LENGTH).optional().describe('Final status'),
  output: z.string().max(MAX_CONTENT_LENGTH, `"output" too long (max ${MAX_CONTENT_LENGTH})`).optional().describe('Task output data'),
});

export const addDependencySchema = z.object({
  taskId: z.string({ message: 'Missing required field "taskId"' }).min(1, 'Missing required field "taskId"').max(MAX_ID_LENGTH).describe('Task ID to add dependency to'),
  dependsOn: z.array(z.string().max(MAX_ID_LENGTH)).min(1, '"dependsOn" must have at least one task ID').max(20, '"dependsOn" max 20 entries').describe('Task IDs this depends on'),
});

export const assignTaskSchema = z.object({
  taskId: z.string({ message: 'Missing required field "taskId"' }).min(1, 'Missing required field "taskId"').max(MAX_ID_LENGTH).describe('Task ID to assign'),
  agentId: z.string({ message: 'Missing required field "agentId"' }).min(1, 'Missing required field "agentId"').max(MAX_ID_LENGTH).describe('Agent ID to assign to'),
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
