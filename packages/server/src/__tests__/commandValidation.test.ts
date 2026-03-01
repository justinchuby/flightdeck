/**
 * Comprehensive tests for Zod-based command input validation.
 *
 * Tests that all command handlers correctly reject invalid payloads
 * with clear error messages via parseCommandPayload.
 */
import { describe, it, expect, vi } from 'vitest';
import { getCommCommands } from '../agents/commands/CommCommands.js';
import { getAgentCommands } from '../agents/commands/AgentCommands.js';
import { getCoordCommands } from '../agents/commands/CoordCommands.js';
import { getSystemCommands } from '../agents/commands/SystemCommands.js';
import { getTimerCommands } from '../agents/commands/TimerCommands.js';
import { getDeferredCommands } from '../agents/commands/DeferredCommands.js';
import { getCapabilityCommands } from '../agents/commands/CapabilityCommands.js';
import { getDirectMessageCommands } from '../agents/commands/DirectMessageCommands.js';
import { getTemplateCommands } from '../agents/commands/TemplateCommands.js';
import { getTaskCommands } from '../agents/commands/TaskCommands.js';
import { parseCommandPayload } from '../agents/commands/commandSchemas.js';
import { z } from 'zod';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// ── Test helpers ─────────────────────────────────────────────────────

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-test-001',
    parentId: 'lead-001',
    role: { id: 'developer', name: 'Developer' },
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeLeadAgent(overrides: Record<string, any> = {}) {
  return makeAgent({
    id: 'lead-001',
    parentId: undefined,
    role: { id: 'lead', name: 'Project Lead' },
    ...overrides,
  });
}

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  return {
    getAgent: vi.fn(),
    getAllAgents: vi.fn().mockReturnValue([]),
    getRunningCount: vi.fn().mockReturnValue(0),
    spawnAgent: vi.fn().mockReturnValue(makeAgent()),
    terminateAgent: vi.fn(),
    emit: vi.fn(),
    roleRegistry: { get: vi.fn(), getAll: vi.fn().mockReturnValue([]) },
    config: {},
    lockRegistry: { acquire: vi.fn(), release: vi.fn(), getByAgent: vi.fn().mockReturnValue([]) },
    activityLedger: { log: vi.fn() },
    messageBus: { send: vi.fn() },
    decisionLog: { add: vi.fn().mockReturnValue({ id: 'dec-1', status: 'pending' }), markSystemDecision: vi.fn() },
    agentMemory: { store: vi.fn(), getByLead: vi.fn().mockReturnValue([]) },
    chatGroupRegistry: {
      create: vi.fn().mockReturnValue({ memberIds: [] }),
      addMembers: vi.fn().mockReturnValue([]),
      removeMembers: vi.fn().mockReturnValue([]),
      sendMessage: vi.fn(),
      getMembers: vi.fn().mockReturnValue([]),
      getGroupsForAgent: vi.fn().mockReturnValue([]),
      findGroupForAgent: vi.fn(),
      getMessages: vi.fn().mockReturnValue([]),
      getGroupSummary: vi.fn().mockReturnValue({ messageCount: 0, lastMessage: null }),
    },
    taskDAG: {
      declareTaskBatch: vi.fn().mockReturnValue({ tasks: [], conflicts: [] }),
      addTask: vi.fn().mockReturnValue({ id: 'test', dagStatus: 'ready' }),
      getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { done: 0, running: 0, ready: 0, pending: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      getTransitionError: vi.fn().mockReturnValue(null),
      completeTask: vi.fn().mockReturnValue([]),
      pauseTask: vi.fn(),
      retryTask: vi.fn(),
      skipTask: vi.fn(),
      cancelTask: vi.fn(),
      resetDAG: vi.fn(),
      findReadyTaskByRole: vi.fn(),
      getTask: vi.fn(),
      startTask: vi.fn(),
      hasActiveTasks: vi.fn().mockReturnValue(false),
      hasAnyTasks: vi.fn().mockReturnValue(false),
      failTask: vi.fn(),
      getTaskByAgent: vi.fn(),
    },
    deferredIssueRegistry: {
      add: vi.fn().mockReturnValue({ id: 1, severity: 'P1', description: 'test' }),
      list: vi.fn().mockReturnValue([]),
      resolve: vi.fn(),
      dismiss: vi.fn(),
    },
    timerRegistry: {
      create: vi.fn().mockReturnValue({ id: 'timer-1', label: 'test', repeat: false }),
      cancel: vi.fn().mockReturnValue(true),
      getAgentTimers: vi.fn().mockReturnValue([]),
      getAllTimers: vi.fn().mockReturnValue([]),
    },
    capabilityInjector: {
      acquire: vi.fn().mockReturnValue({ ok: true, message: 'acquired' }),
      hasCommand: vi.fn().mockReturnValue(false),
      getAllDefinitions: vi.fn().mockReturnValue([]),
      getAgentCapabilities: vi.fn().mockReturnValue([]),
    },
    maxConcurrent: 10,
    markHumanInterrupt: vi.fn(),
    delegations: new Map(),
    reportedCompletions: new Set(),
    pendingSystemActions: new Map(),
    ...overrides,
  } as any;
}

function findHandler(commands: any[], name: string) {
  const cmd = commands.find((c: any) => c.name === name);
  if (!cmd) throw new Error(`Command ${name} not found`);
  return cmd;
}

// ── parseCommandPayload unit tests ───────────────────────────────────

describe('parseCommandPayload', () => {
  const schema = z.object({
    name: z.string({ message: 'name is required' }).min(1, 'name is required'),
    count: z.number().optional(),
  });

  it('returns parsed data on valid input', () => {
    const agent = makeAgent();
    const result = parseCommandPayload(agent, '{"name": "test", "count": 5}', schema, 'TEST');
    expect(result).toEqual({ name: 'test', count: 5 });
    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('returns null and sends error on invalid JSON', () => {
    const agent = makeAgent();
    const result = parseCommandPayload(agent, '{bad json}', schema, 'TEST');
    expect(result).toBeNull();
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('TEST error: invalid JSON payload'),
    );
  });

  it('returns null and sends error on missing required field', () => {
    const agent = makeAgent();
    const result = parseCommandPayload(agent, '{}', schema, 'TEST');
    expect(result).toBeNull();
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('TEST validation error'),
    );
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('name is required'),
    );
  });

  it('returns null and sends error on wrong type', () => {
    const agent = makeAgent();
    const result = parseCommandPayload(agent, '{"name": "test", "count": "not-a-number"}', schema, 'TEST');
    expect(result).toBeNull();
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('TEST validation error'),
    );
  });

  it('includes path in error for nested objects', () => {
    const nestedSchema = z.object({
      items: z.array(z.object({
        id: z.string({ message: 'id is required' }),
      })),
    });
    const agent = makeAgent();
    parseCommandPayload(agent, '{"items": [{"id": "ok"}, {}]}', nestedSchema, 'NESTED');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('items[1].id'),
    );
  });
});

// ── CommCommands validation ──────────────────────────────────────────

describe('CommCommands validation', () => {
  it('AGENT_MESSAGE rejects missing "to"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'AGENT_MSG');
    cmd.handler(agent, '⟦⟦ AGENT_MESSAGE {"content": "hello"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('AGENT_MESSAGE validation error'),
    );
  });

  it('AGENT_MESSAGE rejects missing "content"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'AGENT_MSG');
    cmd.handler(agent, '⟦⟦ AGENT_MESSAGE {"to": "someone"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "content"'),
    );
  });

  it('AGENT_MESSAGE rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'AGENT_MSG');
    cmd.handler(agent, '⟦⟦ AGENT_MESSAGE {broken} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON payload'),
    );
  });

  it('BROADCAST rejects missing "content"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'BROADCAST');
    cmd.handler(agent, '⟦⟦ BROADCAST {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "content"'),
    );
  });

  it('CREATE_GROUP rejects missing "name"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getCommCommands(ctx), 'CREATE_GROUP');
    cmd.handler(agent, '⟦⟦ CREATE_GROUP {"members": ["a"]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CREATE_GROUP validation error'),
    );
  });

  it('CREATE_GROUP rejects when neither members nor roles provided', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getCommCommands(ctx), 'CREATE_GROUP');
    cmd.handler(agent, '⟦⟦ CREATE_GROUP {"name": "test-group"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('members'),
    );
  });

  it('GROUP_MESSAGE rejects missing "group"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'GROUP_MSG');
    cmd.handler(agent, '⟦⟦ GROUP_MESSAGE {"content": "hello"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "group"'),
    );
  });

  it('GROUP_MESSAGE rejects missing "content"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'GROUP_MSG');
    cmd.handler(agent, '⟦⟦ GROUP_MESSAGE {"group": "my-group"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "content"'),
    );
  });

  it('ADD_TO_GROUP rejects missing "group"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'ADD_TO_GROUP');
    cmd.handler(agent, '⟦⟦ ADD_TO_GROUP {"members": ["a"]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "group"'),
    );
  });

  it('REMOVE_FROM_GROUP rejects missing "members"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'REMOVE_FROM_GROUP');
    cmd.handler(agent, '⟦⟦ REMOVE_FROM_GROUP {"group": "grp"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('REMOVE_FROM_GROUP validation error'),
    );
  });
});

// ── AgentCommands validation ─────────────────────────────────────────

describe('AgentCommands validation', () => {
  it('CREATE_AGENT rejects missing "role"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'CREATE_AGENT');
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"task": "do stuff"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CREATE_AGENT validation error'),
    );
  });

  it('CREATE_AGENT rejects empty "role"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'CREATE_AGENT');
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": ""} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CREATE_AGENT validation error'),
    );
  });

  it('CREATE_AGENT rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'CREATE_AGENT');
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {not json} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON payload'),
    );
  });

  it('DELEGATE rejects missing "to"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'DELEGATE');
    cmd.handler(agent, '⟦⟦ DELEGATE {"task": "do stuff"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('DELEGATE validation error'),
    );
  });

  it('DELEGATE rejects missing "task"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'DELEGATE');
    cmd.handler(agent, '⟦⟦ DELEGATE {"to": "agent-123"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "task"'),
    );
  });

  it('TERMINATE_AGENT rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'TERMINATE_AGENT');
    cmd.handler(agent, '⟦⟦ TERMINATE_AGENT {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
  });

  it('CANCEL_DELEGATION rejects empty payload (no agentId or delegationId)', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'CANCEL_DELEGATION');
    cmd.handler(agent, '⟦⟦ CANCEL_DELEGATION {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('requires either "agentId" or "delegationId"'),
    );
  });
});

// ── CoordCommands validation ─────────────────────────────────────────

describe('CoordCommands validation', () => {
  it('LOCK_FILE rejects missing "filePath"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'LOCK');
    cmd.handler(agent, '⟦⟦ LOCK_FILE {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "filePath"'),
    );
  });

  it('LOCK_FILE rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'LOCK');
    cmd.handler(agent, '⟦⟦ LOCK_FILE {bad} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON payload'),
    );
  });

  it('UNLOCK_FILE rejects missing "filePath"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'UNLOCK');
    cmd.handler(agent, '⟦⟦ UNLOCK_FILE {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "filePath"'),
    );
  });

  it('DECISION rejects missing "title"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'DECISION');
    cmd.handler(agent, '⟦⟦ DECISION {"rationale": "because"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "title"'),
    );
  });

  it('COMMIT rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'COMMIT');
    cmd.handler(agent, '⟦⟦ COMMIT {not valid} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT error'),
    );
  });
});

// ── SystemCommands validation ────────────────────────────────────────

describe('SystemCommands validation', () => {
  it('REQUEST_LIMIT_CHANGE rejects non-numeric limit', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getSystemCommands(ctx), 'REQUEST_LIMIT_CHANGE');
    cmd.handler(agent, '⟦⟦ REQUEST_LIMIT_CHANGE {"limit": "abc"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('REQUEST_LIMIT_CHANGE validation error'),
    );
  });

  it('REQUEST_LIMIT_CHANGE rejects limit below 1', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getSystemCommands(ctx), 'REQUEST_LIMIT_CHANGE');
    cmd.handler(agent, '⟦⟦ REQUEST_LIMIT_CHANGE {"limit": 0} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('REQUEST_LIMIT_CHANGE validation error'),
    );
  });

  it('REQUEST_LIMIT_CHANGE rejects limit above 100', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getSystemCommands(ctx), 'REQUEST_LIMIT_CHANGE');
    cmd.handler(agent, '⟦⟦ REQUEST_LIMIT_CHANGE {"limit": 150} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('REQUEST_LIMIT_CHANGE validation error'),
    );
  });
});

// ── TimerCommands validation ─────────────────────────────────────────

describe('TimerCommands validation', () => {
  it('SET_TIMER rejects missing "label"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getTimerCommands(ctx), 'SET_TIMER');
    cmd.handler(agent, '⟦⟦ SET_TIMER {"delay": 30, "message": "check"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "label"'),
    );
  });

  it('SET_TIMER rejects missing "message"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getTimerCommands(ctx), 'SET_TIMER');
    cmd.handler(agent, '⟦⟦ SET_TIMER {"label": "test", "delay": 30} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "message"'),
    );
  });

  it('SET_TIMER rejects delay below 5 seconds', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getTimerCommands(ctx), 'SET_TIMER');
    cmd.handler(agent, '⟦⟦ SET_TIMER {"label": "test", "delay": 2, "message": "check"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('at least 5 seconds'),
    );
  });

  it('SET_TIMER rejects delay above 86400 seconds', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getTimerCommands(ctx), 'SET_TIMER');
    cmd.handler(agent, '⟦⟦ SET_TIMER {"label": "test", "delay": 100000, "message": "check"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('at most 86400'),
    );
  });

  it('CANCEL_TIMER rejects empty payload (no id or name)', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getTimerCommands(ctx), 'CANCEL_TIMER');
    cmd.handler(agent, '⟦⟦ CANCEL_TIMER {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CANCEL_TIMER validation error'),
    );
  });
});

// ── DeferredCommands validation ──────────────────────────────────────

describe('DeferredCommands validation', () => {
  it('DEFER_ISSUE rejects missing "description"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDeferredCommands(ctx), 'DEFER_ISSUE');
    cmd.handler(agent, '⟦⟦ DEFER_ISSUE {"severity": "P2"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "description"'),
    );
  });

  it('RESOLVE_DEFERRED rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDeferredCommands(ctx), 'RESOLVE_DEFERRED');
    cmd.handler(agent, '⟦⟦ RESOLVE_DEFERRED {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('RESOLVE_DEFERRED validation error'),
    );
  });
});

// ── CapabilityCommands validation ────────────────────────────────────

describe('CapabilityCommands validation', () => {
  it('ACQUIRE_CAPABILITY rejects missing "capability"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCapabilityCommands(ctx), 'ACQUIRE_CAPABILITY');
    cmd.handler(agent, '⟦⟦ ACQUIRE_CAPABILITY {"reason": "need it"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('ACQUIRE_CAPABILITY validation error'),
    );
  });

  it('ACQUIRE_CAPABILITY rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCapabilityCommands(ctx), 'ACQUIRE_CAPABILITY');
    cmd.handler(agent, '⟦⟦ ACQUIRE_CAPABILITY {bad} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON payload'),
    );
  });
});

// ── DirectMessageCommands validation ─────────────────────────────────

describe('DirectMessageCommands validation', () => {
  it('DIRECT_MESSAGE rejects missing "to"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDirectMessageCommands(ctx), 'DIRECT_MESSAGE');
    cmd.handler(agent, '⟦⟦ DIRECT_MESSAGE {"content": "hello"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "to"'),
    );
  });

  it('DIRECT_MESSAGE rejects missing "content"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDirectMessageCommands(ctx), 'DIRECT_MESSAGE');
    cmd.handler(agent, '⟦⟦ DIRECT_MESSAGE {"to": "agent-123"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "content"'),
    );
  });

  it('DIRECT_MESSAGE rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDirectMessageCommands(ctx), 'DIRECT_MESSAGE');
    cmd.handler(agent, '⟦⟦ DIRECT_MESSAGE {bad} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON payload'),
    );
  });
});

// ── TaskCommands validation ──────────────────────────────────────────

describe('TaskCommands validation', () => {
  it('ADD_TASK rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'ADD_TASK');
    cmd.handler(agent, '⟦⟦ ADD_TASK {"role": "developer"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('ADD_TASK validation error'),
    );
  });

  it('ADD_TASK rejects missing "role"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'ADD_TASK');
    cmd.handler(agent, '⟦⟦ ADD_TASK {"id": "task-1"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
  });

  it('PAUSE_TASK rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'PAUSE_TASK');
    cmd.handler(agent, '⟦⟦ PAUSE_TASK {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
  });

  it('RETRY_TASK rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'RETRY_TASK');
    cmd.handler(agent, '⟦⟦ RETRY_TASK {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
  });

  it('SKIP_TASK rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'SKIP_TASK');
    cmd.handler(agent, '⟦⟦ SKIP_TASK {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
  });

  it('CANCEL_TASK rejects missing "id"', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'CANCEL_TASK');
    cmd.handler(agent, '⟦⟦ CANCEL_TASK {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
  });

  it('DECLARE_TASKS rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'DECLARE_TASKS');
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {not json} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON payload'),
    );
  });

  it('DECLARE_TASKS rejects empty tasks array', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'DECLARE_TASKS');
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": []} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('DECLARE_TASKS validation error'),
    );
  });

  // ── Size-limit enforcement (.max()) ───────────────────────────────

  it('AGENT_MSG rejects oversized content', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'AGENT_MSG');
    const bigContent = 'x'.repeat(50_001);
    cmd.handler(agent, `⟦⟦ AGENT_MESSAGE {"to":"lead","content":"${bigContent}"} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('AGENT_MESSAGE validation error'),
    );
  });

  it('BROADCAST rejects oversized content', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'BROADCAST');
    const bigContent = 'x'.repeat(50_001);
    cmd.handler(agent, `⟦⟦ BROADCAST {"content":"${bigContent}"} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('BROADCAST validation error'),
    );
  });

  it('CREATE_GROUP rejects too many members', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCommCommands(ctx), 'CREATE_GROUP');
    const members = Array.from({ length: 101 }, (_, i) => `m${i}`);
    cmd.handler(agent, `⟦⟦ CREATE_GROUP ${JSON.stringify({ name: 'grp', members })} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CREATE_GROUP validation error'),
    );
  });

  it('DECLARE_TASKS rejects too many tasks', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getTaskCommands(ctx), 'DECLARE_TASKS');
    const tasks = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, role: 'dev' }));
    cmd.handler(agent, `⟦⟦ DECLARE_TASKS ${JSON.stringify({ tasks })} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('DECLARE_TASKS validation error'),
    );
  });

  it('DELEGATE rejects oversized task text', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = findHandler(getAgentCommands(ctx), 'DELEGATE');
    const bigTask = 'x'.repeat(50_001);
    cmd.handler(agent, `⟦⟦ DELEGATE {"to":"dev","task":"${bigTask}"} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('DELEGATE validation error'),
    );
  });
});

// ── QUERY_DEFERRED validation ────────────────────────────────────────

describe('QUERY_DEFERRED validation', () => {
  it('accepts valid status filter', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDeferredCommands(ctx), 'QUERY_DEFERRED');
    cmd.handler(agent, '⟦⟦ QUERY_DEFERRED {"status": "open"} ⟧⟧');
    // Should not get a validation error (may get "no deferred issues" which is fine)
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('QUERY_DEFERRED validation error'),
    );
  });

  it('accepts no payload', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDeferredCommands(ctx), 'QUERY_DEFERRED');
    cmd.handler(agent, '⟦⟦ QUERY_DEFERRED ⟧⟧');
    // Should not get a validation error
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('QUERY_DEFERRED validation error'),
    );
  });

  it('rejects invalid status value', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDeferredCommands(ctx), 'QUERY_DEFERRED');
    cmd.handler(agent, '⟦⟦ QUERY_DEFERRED {"status": "invalid"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('QUERY_DEFERRED validation error'),
    );
  });

  it('rejects invalid JSON payload', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getDeferredCommands(ctx), 'QUERY_DEFERRED');
    cmd.handler(agent, '⟦⟦ QUERY_DEFERRED {bad json} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('QUERY_DEFERRED error: invalid JSON'),
    );
  });
});

// ── PROGRESS validation ──────────────────────────────────────────────

describe('PROGRESS validation', () => {
  it('accepts valid progress payload', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {"summary": "50% done", "percent": 50} ⟧⟧');
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS validation error'),
    );
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS error'),
    );
  });

  it('rejects invalid JSON payload', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {not valid json} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS error: invalid JSON'),
    );
  });

  it('rejects percent above 100', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {"percent": 150} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS validation error'),
    );
  });

  it('rejects percent below 0', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {"percent": -10} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS validation error'),
    );
  });

  it('strips unknown extra fields silently', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {"custom_field": "value", "summary": "working"} ⟧⟧');
    // Should not error — unknown keys are silently stripped
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS validation error'),
    );
  });

  it('coerces percent from string to number', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {"percent": "50", "summary": "halfway"} ⟧⟧');
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS validation error'),
    );
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS error'),
    );
  });

  it('rejects non-numeric percent string', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    cmd.handler(agent, '⟦⟦ PROGRESS {"percent": "abc"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('PROGRESS validation error'),
    );
  });

  it('rejects oversized payload', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCoordCommands(ctx), 'PROGRESS');
    const bigPayload = `{"data": "${'x'.repeat(50_001)}"}`;
    cmd.handler(agent, `⟦⟦ PROGRESS ${bigPayload} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('payload too large'),
    );
  });
});

// ── RELEASE_CAPABILITY validation ────────────────────────────────────

describe('RELEASE_CAPABILITY validation', () => {
  it('accepts valid payload', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCapabilityCommands(ctx), 'RELEASE_CAPABILITY');
    cmd.handler(agent, '⟦⟦ RELEASE_CAPABILITY {"capability": "code-review"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Capabilities are retained'),
    );
  });

  it('rejects missing "capability"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCapabilityCommands(ctx), 'RELEASE_CAPABILITY');
    cmd.handler(agent, '⟦⟦ RELEASE_CAPABILITY {} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('RELEASE_CAPABILITY validation error'),
    );
  });

  it('rejects invalid JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCapabilityCommands(ctx), 'RELEASE_CAPABILITY');
    cmd.handler(agent, '⟦⟦ RELEASE_CAPABILITY {bad} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('RELEASE_CAPABILITY error: invalid JSON'),
    );
  });

  it('rejects empty "capability"', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmd = findHandler(getCapabilityCommands(ctx), 'RELEASE_CAPABILITY');
    cmd.handler(agent, '⟦⟦ RELEASE_CAPABILITY {"capability": ""} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('RELEASE_CAPABILITY validation error'),
    );
  });
});
