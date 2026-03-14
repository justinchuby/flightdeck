/**
 * Tests for the duplicate-role guard in AgentLifecycle's CREATE_AGENT handler.
 *
 * When a lead with resumeSessionId tries to CREATE_AGENT for a role that
 * already has an active child, the guard redirects to delegation instead of
 * spawning a duplicate. This prevents the race condition during session resume
 * where the lead re-creates agents that were already respawned by the server.
 */
import { describe, it, expect, vi } from 'vitest';
import { getLifecycleCommands } from '../agents/commands/AgentLifecycle.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

function makeLeadAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-001',
    parentId: undefined,
    role: { id: 'lead', name: 'Project Lead' },
    hierarchyLevel: 0,
    sendMessage: vi.fn(),
    projectId: 'proj-1',
    cwd: undefined,
    resumeSessionId: undefined as string | undefined,
    ...overrides,
  } as any;
}

function makeChildAgent(parentId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'child-dev-001',
    parentId,
    role: { id: 'developer', name: 'Developer' },
    dagTaskId: undefined as string | undefined,
    task: undefined as string | undefined,
    status: 'idle',
    sendMessage: vi.fn(),
    sessionId: undefined,
    getRecentOutput: vi.fn().mockReturnValue(''),
    getTaskOutput: vi.fn().mockReturnValue(''),
    clearPendingMessages: vi.fn().mockReturnValue({ count: 0, previews: [] }),
    ...overrides,
  } as any;
}

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  const child = makeChildAgent('lead-001');
  return {
    taskDAG: {
      findReadyTask: vi.fn().mockReturnValue(null),
      startTask: vi.fn().mockReturnValue({ id: 'auto-task', dagStatus: 'running' }),
      addTask: vi.fn().mockImplementation((_leadId: string, task: any) => ({
        id: task.taskId,
        role: task.role,
        title: task.title,
        description: task.description || '',
        dagStatus: 'ready',
        dependsOn: [],
        files: [],
        priority: 0,
      })),
      completeTask: vi.fn().mockReturnValue([]),
      getTask: vi.fn().mockReturnValue(null),
      getTasks: vi.fn().mockReturnValue([]),
      getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0 } }),
      hasActiveTasks: vi.fn().mockReturnValue(false),
      hasAnyTasks: vi.fn().mockReturnValue(false),
      addDependency: vi.fn().mockReturnValue(true),
      forceStartTask: vi.fn().mockReturnValue(null),
    },
    getAgent: vi.fn().mockReturnValue(undefined),
    getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
    getAllAgents: vi.fn().mockReturnValue([child]),
    getRunningCount: vi.fn().mockReturnValue(1),
    spawnAgent: vi.fn().mockReturnValue(child),
    terminateAgent: vi.fn().mockReturnValue(true),
    emit: vi.fn(),
    roleRegistry: {
      get: vi.fn().mockReturnValue({ id: 'developer', name: 'Developer' }),
      getAll: vi.fn().mockReturnValue([]),
    },
    config: {},
    lockRegistry: { getByAgent: vi.fn().mockReturnValue([]) },
    activityLedger: { log: vi.fn() },
    messageBus: { send: vi.fn() },
    decisionLog: { log: vi.fn() },
    agentMemory: { store: vi.fn() },
    chatGroupRegistry: {},
    delegations: new Map(),
    reportedCompletions: new Set(),
    pendingSystemActions: new Map(),
    maxConcurrent: 50,
    markHumanInterrupt: vi.fn(), haltHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(),
    ...overrides,
  } as any;
}

function getCreateAgentHandler(ctx: CommandHandlerContext) {
  const cmds = getLifecycleCommands(ctx);
  const cmd = cmds.find(c => c.name === 'CREATE_AGENT');
  if (!cmd) throw new Error('CREATE_AGENT command not found');
  return cmd;
}

// ── Duplicate-role guard tests ──────────────────────────────────────

describe('CREATE_AGENT duplicate-role guard (session resume)', () => {
  it('blocks duplicate role and delegates to existing agent when lead has resumeSessionId', () => {
    const existingDev = makeChildAgent('lead-001', { id: 'dev-existing', status: 'running' });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([existingDev]),
    });
    const lead = makeLeadAgent({ resumeSessionId: 'prev-session-123' });
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(lead, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "implement feature X"} ⟧⟧');

    // Should NOT spawn a new agent
    expect(ctx.spawnAgent).not.toHaveBeenCalled();

    // Should notify the lead about the redirect
    expect(lead.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );

    // Should delegate task to existing agent
    expect(existingDev.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('implement feature X'),
    );
  });

  it('allows CREATE_AGENT when lead does NOT have resumeSessionId (normal flow)', () => {
    const existingDev = makeChildAgent('lead-001', { id: 'dev-existing', status: 'running' });
    const newChild = makeChildAgent('lead-001', { id: 'dev-new' });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([existingDev]),
      spawnAgent: vi.fn().mockReturnValue(newChild),
    });
    const lead = makeLeadAgent(); // no resumeSessionId

    const cmd = getCreateAgentHandler(ctx);
    cmd.handler(lead, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "implement feature Y"} ⟧⟧');

    // SHOULD spawn — guard only applies during resume
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });

  it('allows CREATE_AGENT for a different role during resume', () => {
    const existingDev = makeChildAgent('lead-001', { id: 'dev-existing', status: 'running', role: { id: 'developer', name: 'Developer' } });
    const newArchitect = makeChildAgent('lead-001', { id: 'arch-new', role: { id: 'architect', name: 'Architect' } });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([existingDev]),
      spawnAgent: vi.fn().mockReturnValue(newArchitect),
      roleRegistry: {
        get: vi.fn().mockReturnValue({ id: 'architect', name: 'Architect' }),
        getAll: vi.fn().mockReturnValue([]),
      },
    });
    const lead = makeLeadAgent({ resumeSessionId: 'prev-session-123' });

    const cmd = getCreateAgentHandler(ctx);
    cmd.handler(lead, '⟦⟦ CREATE_AGENT {"role": "architect", "task": "review architecture"} ⟧⟧');

    // SHOULD spawn — different role, no conflict
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });

  it('allows CREATE_AGENT when existing same-role agent is terminated', () => {
    const terminatedDev = makeChildAgent('lead-001', {
      id: 'dev-terminated',
      status: 'terminated',
    });
    const newChild = makeChildAgent('lead-001', { id: 'dev-new' });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([terminatedDev]),
      spawnAgent: vi.fn().mockReturnValue(newChild),
    });
    const lead = makeLeadAgent({ resumeSessionId: 'prev-session-123' });

    const cmd = getCreateAgentHandler(ctx);
    cmd.handler(lead, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "new task"} ⟧⟧');

    // SHOULD spawn — existing agent is terminated, not active
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });

  it('includes context in delegated message', () => {
    const existingDev = makeChildAgent('lead-001', { id: 'dev-existing', status: 'idle' });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([existingDev]),
    });
    const lead = makeLeadAgent({ resumeSessionId: 'prev-session-123' });

    const cmd = getCreateAgentHandler(ctx);
    cmd.handler(lead, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "fix bug", "context": "See issue #42"} ⟧⟧');

    expect(existingDev.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('See issue #42'),
    );
  });

  it('blocks when existing agent has creating status', () => {
    const creatingDev = makeChildAgent('lead-001', { id: 'dev-creating', status: 'creating' });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([creatingDev]),
    });
    const lead = makeLeadAgent({ resumeSessionId: 'prev-session-123' });

    const cmd = getCreateAgentHandler(ctx);
    cmd.handler(lead, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "do work"} ⟧⟧');

    // Should block — creating is an active status
    expect(ctx.spawnAgent).not.toHaveBeenCalled();
    expect(lead.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
  });
});
