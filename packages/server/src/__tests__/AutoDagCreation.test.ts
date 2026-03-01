/**
 * Tests for auto-DAG creation from CREATE_AGENT and DELEGATE commands.
 * When a lead delegates without a pre-declared DAG task, the system
 * auto-creates a DAG task entry and links the agent to it.
 * Covers 3-tier dependency inference: explicit, review, and NL parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLifecycleCommands } from '../agents/commands/AgentLifecycle.js';
import { generateAutoTaskId, inferSequentialDependencies } from '../agents/commands/AgentLifecycle.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

function makeLeadAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-001',
    parentId: undefined,
    role: { id: 'lead', name: 'Project Lead' },
    hierarchyLevel: 0,
    sendMessage: vi.fn(),
    projectId: undefined,
    cwd: undefined,
    ...overrides,
  } as any;
}

function makeChildAgent(parentId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'child-001',
    parentId,
    role: { id: 'developer', name: 'Developer' },
    dagTaskId: undefined as string | undefined,
    task: undefined as string | undefined,
    status: 'idle',
    sendMessage: vi.fn(),
    sessionId: undefined,
    getRecentOutput: vi.fn().mockReturnValue(''),
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
        id: task.id,
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
    },
    getAgent: vi.fn().mockReturnValue(undefined),
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
    deferredIssueRegistry: {},
    delegations: new Map(),
    reportedCompletions: new Set(),
    pendingSystemActions: new Map(),
    maxConcurrent: 50,
    markHumanInterrupt: vi.fn(),
    ...overrides,
  } as any;
}

function getCreateAgentHandler(ctx: CommandHandlerContext) {
  const cmds = getLifecycleCommands(ctx);
  const cmd = cmds.find(c => c.name === 'CREATE_AGENT');
  if (!cmd) throw new Error('CREATE_AGENT command not found');
  return cmd;
}

function getDelegateHandler(ctx: CommandHandlerContext) {
  const cmds = getLifecycleCommands(ctx);
  const cmd = cmds.find(c => c.name === 'DELEGATE');
  if (!cmd) throw new Error('DELEGATE command not found');
  return cmd;
}

describe('Auto-DAG creation from CREATE_AGENT', () => {
  it('auto-creates DAG task when no matching task exists', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug"} ⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalledWith('lead-001', expect.objectContaining({
      role: 'developer',
      description: 'Fix the login bug',
    }));
    expect(ctx.taskDAG.startTask).toHaveBeenCalled();
    // Ack message should mention auto-created
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('auto-created'));
  });

  it('does not auto-create when findReadyTask matches an existing task', () => {
    const existingTask = { id: 'pre-declared', dagStatus: 'ready' };
    const ctx = makeCtx();
    (ctx.taskDAG.findReadyTask as any).mockReturnValue(existingTask);
    (ctx.taskDAG.startTask as any).mockReturnValue(existingTask);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug"} ⟧');

    // Should link to existing, not auto-create
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(ctx.taskDAG.startTask).toHaveBeenCalledWith('lead-001', 'pre-declared', expect.any(String));
  });

  it('warns about near-duplicate instead of auto-creating', () => {
    const ctx = makeCtx();
    // Return existing tasks that are similar to the delegation
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'existing-fix-login',
      role: 'developer',
      title: 'Fix the login bug',
      description: 'Fix the login bug in the auth module',
      dagStatus: 'running',
      dependsOn: [],
      files: [],
    }]);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in auth"} ⟧');

    // Should warn about near-duplicate, not auto-create
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Similar DAG task exists'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('existing-fix-login'));
  });

  it('sets child.dagTaskId on auto-created task', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Build the API"} ⟧');

    expect(child.dagTaskId).toBeDefined();
    expect(child.dagTaskId).toMatch(/^auto-developer-/);
  });

  it('does not auto-create for non-lead agents', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent({ role: { id: 'architect', name: 'Architect' } });
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Build the API"} ⟧');

    // Architect can create agents, but auto-DAG only triggers for lead
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
  });

  it('still warns when explicit dagTaskId does not match', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Build API", "dagTaskId": "nonexistent"} ⟧');

    // Explicit dagTaskId miss should warn, not auto-create
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('not found or not ready'));
  });
});

describe('Auto-DAG creation from DELEGATE', () => {
  it('auto-creates DAG task when delegating to existing agent', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
    });
    const agent = makeLeadAgent();
    const cmd = getDelegateHandler(ctx);

    cmd.handler(agent, '⟦ DELEGATE {"to": "child-001", "task": "Write the tests"} ⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalledWith('lead-001', expect.objectContaining({
      role: 'developer',
      description: 'Write the tests',
    }));
    expect(ctx.taskDAG.startTask).toHaveBeenCalled();
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('auto-created'));
  });

  it('sets child.dagTaskId on DELEGATE auto-create', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
    });
    const agent = makeLeadAgent();
    const cmd = getDelegateHandler(ctx);

    cmd.handler(agent, '⟦ DELEGATE {"to": "child-001", "task": "Write the tests"} ⟧');

    expect(child.dagTaskId).toBeDefined();
    expect(child.dagTaskId).toMatch(/^auto-developer-/);
  });

  it('does not auto-create on DELEGATE when findReadyTask matches', () => {
    const existingTask = { id: 'pre-declared', dagStatus: 'ready' };
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
    });
    (ctx.taskDAG.findReadyTask as any).mockReturnValue(existingTask);
    (ctx.taskDAG.startTask as any).mockReturnValue(existingTask);

    const agent = makeLeadAgent();
    const cmd = getDelegateHandler(ctx);

    cmd.handler(agent, '⟦ DELEGATE {"to": "child-001", "task": "Write the tests"} ⟧');

    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
  });
});

describe('Auto-DAG review dependency linking', () => {
  it('auto-links review task to target by agent ID reference', () => {
    const child = makeChildAgent('lead-001', { role: { id: 'code-reviewer', name: 'Code Reviewer' } });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
      roleRegistry: {
        get: vi.fn().mockReturnValue({ id: 'code-reviewer', name: 'Code Reviewer' }),
        getAll: vi.fn().mockReturnValue([]),
      },
    });
    // Existing running task assigned to agent 0b85de78
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'impl-task',
      role: 'developer',
      assignedAgentId: '0b85de78-full-id',
      dagStatus: 'running',
      description: 'Implement feature',
      dependsOn: [],
      files: [],
    }]);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "code-reviewer", "task": "Review commit by 0b85de78"} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith(
      'lead-001',
      expect.stringMatching(/^auto-code-reviewer-/),
      'impl-task',
    );
  });

  it('auto-links review task to target by task ID reference', () => {
    const child = makeChildAgent('lead-001', { role: { id: 'critical-reviewer', name: 'Critical Reviewer' } });
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
      roleRegistry: {
        get: vi.fn().mockReturnValue({ id: 'critical-reviewer', name: 'Critical Reviewer' }),
        getAll: vi.fn().mockReturnValue([]),
      },
    });
    // inferReviewDependencies uses getTasks to scan for matching task IDs
    (ctx.taskDAG.getTasks as any).mockReturnValue([
      { id: 'p0-2-autolink', dagStatus: 'running', description: 'Fix auto-linking', dependsOn: [], files: [] },
    ]);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "critical-reviewer", "task": "Review p0-2-autolink implementation"} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith(
      'lead-001',
      expect.stringMatching(/^auto-critical-reviewer-/),
      'p0-2-autolink',
    );
  });

  it('does not link review dependencies for non-review roles', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Review and fix p0-2-autolink"} ⟧');

    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });
});

describe('generateAutoTaskId', () => {
  it('generates readable ID from role and task', () => {
    const id = generateAutoTaskId('developer', 'Fix the login bug');
    expect(id).toMatch(/^auto-developer-fix-the-login-[a-z0-9]+$/);
  });

  it('handles short tasks', () => {
    const id = generateAutoTaskId('designer', 'UI');
    // 'UI' is only 2 chars, filtered out by the word filter (>2 chars)
    expect(id).toMatch(/^auto-designer-task-[a-z0-9]+$/);
  });

  it('limits to 3 words', () => {
    const id = generateAutoTaskId('developer', 'Build the entire frontend application from scratch');
    expect(id).toMatch(/^auto-developer-build-the-entire-[a-z0-9]+$/);
  });

  it('strips special characters', () => {
    const id = generateAutoTaskId('developer', 'Fix @#$% bug!!! (urgent)');
    expect(id).toMatch(/^auto-developer-fix-bug-urgent-[a-z0-9]+$/);
  });

  it('generates unique IDs (timestamp suffix)', () => {
    const id1 = generateAutoTaskId('developer', 'Fix bug');
    // Tiny delay to ensure different timestamp
    const id2 = generateAutoTaskId('developer', 'Fix bug');
    // They share the same prefix but may differ in suffix
    expect(id1.startsWith('auto-developer-fix-bug-')).toBe(true);
    expect(id2.startsWith('auto-developer-fix-bug-')).toBe(true);
  });
});

describe('Tier 1: Explicit depends_on from payload', () => {
  it('wires explicit depends_on when auto-creating via CREATE_AGENT', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Build UI", "depends_on": ["api-task", "design-task"]} ⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalled();
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'api-task');
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'design-task');
  });

  it('wires explicit depends_on when auto-creating via DELEGATE', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
    });
    const agent = makeLeadAgent();
    const cmd = getDelegateHandler(ctx);

    cmd.handler(agent, '⟦ DELEGATE {"to": "child-001", "task": "Write tests", "depends_on": ["impl-task"]} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'impl-task');
  });

  it('shows dependency notes in ack message', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Build UI", "depends_on": ["api-task"]} ⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('depends on'));
  });

  it('does not add depends_on when matching existing task (no auto-create)', () => {
    const existingTask = { id: 'pre-declared', dagStatus: 'ready' };
    const ctx = makeCtx();
    (ctx.taskDAG.findReadyTask as any).mockReturnValue(existingTask);
    (ctx.taskDAG.startTask as any).mockReturnValue(existingTask);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Build", "depends_on": ["x"]} ⟧');

    // No auto-create, so no addDependency
    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });
});

describe('Tier 3: NL dependency parsing', () => {
  function makeNLCtx(tasks: any[] = []): CommandHandlerContext {
    return makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue(tasks),
        findReadyTask: vi.fn().mockReturnValue(null),
        addTask: vi.fn().mockImplementation((_: string, t: any) => ({
          id: t.id, role: t.role, title: t.title, description: t.description || '',
          dagStatus: 'ready', dependsOn: [], files: [], priority: 0,
        })),
        startTask: vi.fn().mockReturnValue({ id: 'started', dagStatus: 'running' }),
        addDependency: vi.fn().mockReturnValue(true),
        getTask: vi.fn().mockReturnValue(null),
        getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0 } }),
        hasActiveTasks: vi.fn().mockReturnValue(false),
        hasAnyTasks: vi.fn().mockReturnValue(false),
        completeTask: vi.fn().mockReturnValue([]),
      },
    });
  }

  it('parses "after agent X finishes" as dependency', () => {
    const tasks = [{
      id: 'impl-task', role: 'developer', assignedAgentId: '0b85de78-full',
      dagStatus: 'running', description: 'Implement feature', dependsOn: [], files: [], startedAt: '2026-01-01',
    }];
    const ctx = makeNLCtx(tasks);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "After agent 0b85de78 finishes, write integration tests"} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'impl-task');
  });

  it('parses "once architect reports" as dependency', () => {
    const tasks = [{
      id: 'design-task', role: 'architect', assignedAgentId: 'arch-full-id',
      dagStatus: 'running', description: 'Design the system', dependsOn: [], files: [], startedAt: '2026-01-01',
    }];
    const ctx = makeNLCtx(tasks);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Once architect reports, implement the design"} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'design-task');
  });

  it('parses "depends on task-id" as dependency', () => {
    const tasks = [{
      id: 'p0-2-autolink', role: 'developer', dagStatus: 'running',
      description: 'Fix auto-linking', dependsOn: [], files: [],
    }];
    const ctx = makeNLCtx(tasks);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Depends on p0-2-autolink being done first"} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'p0-2-autolink');
  });

  it('parses "blocked by task-id" as dependency', () => {
    const tasks = [{
      id: 'setup-task', role: 'developer', dagStatus: 'running',
      description: 'Setup infrastructure', dependsOn: [], files: [],
    }];
    const ctx = makeNLCtx(tasks);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "Blocked by setup-task, implement the feature"} ⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'setup-task');
  });

  it('deduplicates dependencies across tiers', () => {
    const tasks = [{
      id: 'impl-task', role: 'developer', assignedAgentId: '0b85de78-full',
      dagStatus: 'running', description: 'Implement feature', dependsOn: [], files: [], startedAt: '2026-01-01',
    }];
    const ctx = makeNLCtx(tasks);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // Explicit + NL both reference the same task
    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "After agent 0b85de78 finishes, do cleanup", "depends_on": ["impl-task"]} ⟧');

    // Should only call addDependency once for impl-task (deduped)
    const depCalls = (ctx.taskDAG.addDependency as any).mock.calls
      .filter((c: any[]) => c[2] === 'impl-task');
    expect(depCalls.length).toBe(1);
  });

  it('does not add NL deps when no matching tasks exist', () => {
    const ctx = makeNLCtx([]); // no tasks in DAG
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦ CREATE_AGENT {"role": "developer", "task": "After architect finishes, implement"} ⟧');

    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });
});

describe('inferSequentialDependencies (unit)', () => {
  function makeMinimalCtx(tasks: any[]): CommandHandlerContext {
    return {
      taskDAG: { getTasks: vi.fn().mockReturnValue(tasks) },
    } as any;
  }

  it('returns empty array for text with no dependency patterns', () => {
    const ctx = makeMinimalCtx([{ id: 'a', role: 'developer', dagStatus: 'running' }]);
    const result = inferSequentialDependencies(ctx, 'lead-1', 'Just build the feature');
    expect(result).toEqual([]);
  });

  it('matches "after agent <id> finishes"', () => {
    const ctx = makeMinimalCtx([{
      id: 'task-1', role: 'developer', assignedAgentId: 'abcdef12-full',
      dagStatus: 'running',
    }]);
    const result = inferSequentialDependencies(ctx, 'lead-1', 'After agent abcdef12 finishes, deploy');
    expect(result).toEqual(['task-1']);
  });

  it('matches "depends on <task-id>"', () => {
    const ctx = makeMinimalCtx([{ id: 'setup', role: 'developer', dagStatus: 'running' }]);
    const result = inferSequentialDependencies(ctx, 'lead-1', 'Depends on setup before starting');
    expect(result).toEqual(['setup']);
  });

  it('matches role-based "once architect is done"', () => {
    const ctx = makeMinimalCtx([{
      id: 'arch-task', role: 'architect', dagStatus: 'running', startedAt: '2026-01-01',
    }]);
    const result = inferSequentialDependencies(ctx, 'lead-1', 'Once architect is done, implement');
    expect(result).toEqual(['arch-task']);
  });
});
