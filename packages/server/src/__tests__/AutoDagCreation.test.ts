/**
 * Tests for auto-DAG creation from CREATE_AGENT and DELEGATE commands.
 * When a lead delegates without a pre-declared DAG task, the system
 * auto-creates a DAG task entry and links the agent to it.
 * Covers dependency inference: explicit dependsOn, review inference, and Secretary-assisted analysis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLifecycleCommands } from '../agents/commands/AgentLifecycle.js';
import { generateAutoTaskId, requestSecretaryDependencyAnalysis, maybeSuggestDagGroup, suggestedGroupNames, inferReviewDependencies } from '../agents/commands/AgentLifecycle.js';
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
      addTask: vi.fn().mockImplementation((_leadId: string, task: any, _projectId?: string) => ({
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

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug"} ⟧⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalledWith('lead-001', expect.objectContaining({
      role: 'developer',
      description: 'Fix the login bug',
    }), 'proj-1');
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

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug"} ⟧⟧');

    // Should link to existing, not auto-create
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(ctx.taskDAG.startTask).toHaveBeenCalledWith('lead-001', 'pre-declared', expect.any(String));
  });

  it('warns about possible duplicate for borderline similarity', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Return existing tasks that are similar to the delegation (0.8-0.95 similarity)
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

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in auth"} ⟧⟧');

    // With borderline similarity (0.8-0.95), task is created anyway but with a warning
    expect(ctx.taskDAG.addTask).toHaveBeenCalled();
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Possible duplicate'));
  });

  it('links to existing ready declared task instead of creating duplicate', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Existing ready task with near-identical description (>0.95 similarity)
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'declared-fix-login',
      role: 'developer',
      title: 'Fix the login bug',
      description: 'Fix the login bug in the auth module',
      dagStatus: 'ready',
      dependsOn: [],
      files: [],
    }]);
    (ctx.taskDAG.startTask as any).mockReturnValue({ id: 'declared-fix-login', dagStatus: 'running' });

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in the auth module"} ⟧⟧');

    // Should link to existing, not auto-create
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(ctx.taskDAG.startTask).toHaveBeenCalledWith('lead-001', 'declared-fix-login', expect.any(String));
    expect(child.dagTaskId).toBe('declared-fix-login');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('linked to'));
  });

  it('force-links to pending declared task instead of creating duplicate', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Existing pending task with near-identical description (>0.95 similarity)
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'declared-pending-task',
      role: 'developer',
      title: 'Fix the login bug',
      description: 'Fix the login bug in the auth module',
      dagStatus: 'pending',
      dependsOn: ['other-task'],
      files: [],
    }]);
    // startTask fails for pending (not ready), forceStartTask succeeds
    (ctx.taskDAG.startTask as any).mockReturnValue(null);
    (ctx.taskDAG.forceStartTask as any).mockReturnValue({ id: 'declared-pending-task', dagStatus: 'running' });

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in the auth module"} ⟧⟧');

    // Should force-link to existing pending task
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(ctx.taskDAG.forceStartTask).toHaveBeenCalledWith('lead-001', 'declared-pending-task', expect.any(String));
    expect(child.dagTaskId).toBe('declared-pending-task');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('linked to'));
  });

  it('force-links to blocked declared task instead of creating duplicate', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Near-identical description (>0.95 similarity)
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'declared-blocked-task',
      role: 'developer',
      title: 'Fix the login bug',
      description: 'Fix the login bug in the auth module',
      dagStatus: 'blocked',
      dependsOn: ['other-task'],
      files: [],
    }]);
    (ctx.taskDAG.startTask as any).mockReturnValue(null);
    (ctx.taskDAG.forceStartTask as any).mockReturnValue({ id: 'declared-blocked-task', dagStatus: 'running' });

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in the auth module"} ⟧⟧');

    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(ctx.taskDAG.forceStartTask).toHaveBeenCalledWith('lead-001', 'declared-blocked-task', expect.any(String));
    expect(child.dagTaskId).toBe('declared-blocked-task');
  });

  it('sets child.dagTaskId on auto-created task', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build the API"} ⟧⟧');

    expect(child.dagTaskId).toBeDefined();
    expect(child.dagTaskId).toMatch(/^auto-developer-/);
  });

  it('does not auto-create for non-lead agents', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent({ role: { id: 'architect', name: 'Architect' } });
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build the API"} ⟧⟧');

    // Architect can create agents, but auto-DAG only triggers for lead
    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
  });

  it('still warns when explicit dagTaskId does not match', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build API", "dagTaskId": "nonexistent"} ⟧⟧');

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

    cmd.handler(agent, '⟦⟦ DELEGATE {"to": "child-001", "task": "Write the tests"} ⟧⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalledWith('lead-001', expect.objectContaining({
      role: 'developer',
      description: 'Write the tests',
    }), 'proj-1');
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

    cmd.handler(agent, '⟦⟦ DELEGATE {"to": "child-001", "task": "Write the tests"} ⟧⟧');

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

    cmd.handler(agent, '⟦⟦ DELEGATE {"to": "child-001", "task": "Write the tests"} ⟧⟧');

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

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "code-reviewer", "task": "Review commit by 0b85de78"} ⟧⟧');

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

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "critical-reviewer", "task": "Review p0-2-autolink implementation"} ⟧⟧');

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

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Review and fix p0-2-autolink"} ⟧⟧');

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

describe('Tier 1: Explicit dependsOn from payload', () => {
  it('wires explicit dependsOn when auto-creating via CREATE_AGENT', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build UI", "dependsOn": ["api-task", "design-task"]} ⟧⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalled();
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'api-task');
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'design-task');
  });

  it('wires explicit dependsOn when auto-creating via DELEGATE', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([child]),
    });
    const agent = makeLeadAgent();
    const cmd = getDelegateHandler(ctx);

    cmd.handler(agent, '⟦⟦ DELEGATE {"to": "child-001", "task": "Write tests", "dependsOn": ["impl-task"]} ⟧⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.stringMatching(/^auto-/), 'impl-task');
  });

  it('shows dependency notes in ack message', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build UI", "dependsOn": ["api-task"]} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('depends on'));
  });

  it('does not add dependsOn when matching existing task (no auto-create)', () => {
    const existingTask = { id: 'pre-declared', dagStatus: 'ready' };
    const ctx = makeCtx();
    (ctx.taskDAG.findReadyTask as any).mockReturnValue(existingTask);
    (ctx.taskDAG.startTask as any).mockReturnValue(existingTask);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build", "dependsOn": ["x"]} ⟧⟧');

    // No auto-create, so no addDependency
    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });
});

describe('Critical review fixes', () => {
  it('#1: addTask exception is caught gracefully (no crash on ID collision)', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue([]),
        findReadyTask: vi.fn().mockReturnValue(null),
        addTask: vi.fn().mockImplementation(() => { throw new Error('Task "auto-x" already exists'); }),
        getTask: vi.fn().mockReturnValue(null),
        getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0 } }),
        hasActiveTasks: vi.fn().mockReturnValue(false),
        hasAnyTasks: vi.fn().mockReturnValue(false),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // Should not throw — gracefully handles the error
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build something"} ⟧⟧');

    // Agent still gets created (ack message sent)
    expect(agent.sendMessage).toHaveBeenCalled();
  });

  it('#2: near-duplicate check ignores done/skipped/cancelled tasks', () => {
    const doneTasks = [{
      id: 'old-task', role: 'developer', dagStatus: 'done',
      description: 'Fix the CSS styling', title: 'Fix CSS', dependsOn: [], files: [],
    }];
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue(doneTasks),
        findReadyTask: vi.fn().mockReturnValue(null),
        addTask: vi.fn().mockImplementation((_: string, t: any) => ({
          id: t.taskId, role: t.role, title: t.title, description: t.description || '',
          dagStatus: 'ready', dependsOn: [], files: [], priority: 0,
        })),
        startTask: vi.fn().mockReturnValue({ id: 'started', dagStatus: 'running' }),
        addDependency: vi.fn().mockReturnValue(true),
        getTask: vi.fn().mockReturnValue(null),
        getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0 } }),
        hasActiveTasks: vi.fn().mockReturnValue(false),
        hasAnyTasks: vi.fn().mockReturnValue(false),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // Same description as old completed task — should NOT be blocked
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the CSS styling"} ⟧⟧');

    expect(ctx.taskDAG.addTask).toHaveBeenCalled();
  });

  it('#3: hex regex only matches exactly 8-char agent IDs', () => {
    const tasks = [
      { id: 'task-1', role: 'developer', assignedAgentId: 'deadbeef-full-uuid', dagStatus: 'running', description: 'Work', dependsOn: [], files: [] },
    ];
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue(tasks),
        findReadyTask: vi.fn().mockReturnValue(null),
        addTask: vi.fn().mockImplementation((_: string, t: any) => ({
          id: t.taskId, role: t.role, title: t.title, description: t.description || '',
          dagStatus: 'ready', dependsOn: [], files: [], priority: 0,
        })),
        startTask: vi.fn().mockReturnValue({ id: 'started', dagStatus: 'running' }),
        addDependency: vi.fn().mockReturnValue(true),
        getTask: vi.fn().mockReturnValue(null),
        getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0 } }),
        hasActiveTasks: vi.fn().mockReturnValue(false),
        hasAnyTasks: vi.fn().mockReturnValue(false),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // 40-char SHA should NOT match as agent ID
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "code-reviewer", "task": "Review commit deadbeefcafe1234abcd5678 for bugs"} ⟧⟧');

    // Should not create dependency from long hex string
    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });

  it('#5: exact task ID match preferred over prefix match', () => {
    const tasks = [
      { id: 'p0-2', role: 'developer', dagStatus: 'running', description: 'Short task', dependsOn: [], files: [] },
      { id: 'p0-2-autolink', role: 'developer', dagStatus: 'running', description: 'Autolink task', dependsOn: [], files: [] },
    ];
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue(tasks),
        findReadyTask: vi.fn().mockReturnValue(null),
        addTask: vi.fn().mockImplementation((_: string, t: any) => ({
          id: t.taskId, role: t.role, title: t.title, description: t.description || '',
          dagStatus: 'ready', dependsOn: [], files: [], priority: 0,
        })),
        startTask: vi.fn().mockReturnValue({ id: 'started', dagStatus: 'running' }),
        addDependency: vi.fn().mockReturnValue(true),
        getTask: vi.fn().mockReturnValue(null),
        getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0 } }),
        hasActiveTasks: vi.fn().mockReturnValue(false),
        hasAnyTasks: vi.fn().mockReturnValue(false),
      },
      roleRegistry: {
        get: vi.fn().mockReturnValue({ id: 'code-reviewer', name: 'Code Reviewer' }),
        getAll: vi.fn().mockReturnValue([]),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // "p0-2" should match "p0-2" exactly, not prefix-match "p0-2-autolink"
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "code-reviewer", "task": "Review p0-2 implementation"} ⟧⟧');

    // The dependency should be on "p0-2" (exact), not "p0-2-autolink" (prefix)
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', expect.any(String), 'p0-2');
  });
});

describe('Tier 3: Secretary-assisted dependency inference', () => {
  function makeSecretaryCtx(tasks: any[] = [], secretaryAgent?: any): CommandHandlerContext {
    return makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue(tasks),
        findReadyTask: vi.fn().mockReturnValue(null),
        addTask: vi.fn().mockImplementation((_: string, t: any) => ({
          id: t.taskId, role: t.role, title: t.title, description: t.description || '',
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
      getAllAgents: vi.fn().mockReturnValue(
        secretaryAgent ? [secretaryAgent] : []
      ),
    });
  }

  it('sends message to Secretary when no Tier 1/2 deps found', () => {
    const secretaryAgent = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'running', sendMessage: vi.fn(),
    };
    const tasks = [{
      id: 'impl-task', role: 'developer', dagStatus: 'ready',
      description: 'Implement feature', dependsOn: [], files: [],
    }];
    const ctx = makeSecretaryCtx(tasks, secretaryAgent);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build the deployment pipeline"} ⟧⟧');

    expect(secretaryAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Dependency analysis needed')
    );
    expect(secretaryAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('ADD_DEPENDENCY')
    );
  });

  it('skips Secretary request when no Secretary agent exists', () => {
    const tasks = [{
      id: 'impl-task', role: 'developer', dagStatus: 'running',
      description: 'Implement feature', dependsOn: [], files: [],
    }];
    const ctx = makeSecretaryCtx(tasks); // no secretary
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build the deployment pipeline"} ⟧⟧');

    // Should not throw — silently skip
    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });

  it('skips Secretary request when no active tasks exist', () => {
    const secretaryAgent = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'running', sendMessage: vi.fn(),
    };
    const ctx = makeSecretaryCtx([], secretaryAgent); // empty tasks
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build something"} ⟧⟧');

    expect(secretaryAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send to terminated Secretary', () => {
    const secretaryAgent = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'terminated', sendMessage: vi.fn(),
    };
    const tasks = [{
      id: 'impl-task', role: 'developer', dagStatus: 'running',
      description: 'Implement feature', dependsOn: [], files: [],
    }];
    const ctx = makeSecretaryCtx(tasks, secretaryAgent);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build deployment"} ⟧⟧');

    expect(secretaryAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send Secretary request when explicit deps exist', () => {
    const secretaryAgent = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'running', sendMessage: vi.fn(),
    };
    const tasks = [{
      id: 'setup-task', role: 'developer', dagStatus: 'running',
      description: 'Setup infra', dependsOn: [], files: [],
    }];
    const ctx = makeSecretaryCtx(tasks, secretaryAgent);
    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build feature", "dependsOn": ["setup-task"]} ⟧⟧');

    // Has explicit dep — Secretary not needed
    expect(secretaryAgent.sendMessage).not.toHaveBeenCalled();
  });
});

describe('requestSecretaryDependencyAnalysis (unit)', () => {
  it('sends structured message with active task list', () => {
    const secretary = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'running', sendMessage: vi.fn(),
    };
    const ctx = {
      getAllAgents: vi.fn().mockReturnValue([secretary]),
      taskDAG: {
        getTasks: vi.fn().mockReturnValue([
          { id: 'task-a', dagStatus: 'ready', description: 'Build API', role: 'developer' },
          { id: 'task-b', dagStatus: 'ready', description: 'Write tests', role: 'tester' },
        ]),
      },
    } as any;

    requestSecretaryDependencyAnalysis(ctx, 'lead-001', 'new-task', 'Deploy the API');

    expect(secretary.sendMessage).toHaveBeenCalledTimes(1);
    const msg = secretary.sendMessage.mock.calls[0][0];
    expect(msg).toContain('new-task');
    expect(msg).toContain('task-a');
    expect(msg).toContain('task-b');
    expect(msg).toContain('ADD_DEPENDENCY');
  });

  it('skips when no secretary exists', () => {
    const ctx = {
      getAllAgents: vi.fn().mockReturnValue([]),
      taskDAG: {
        getTasks: vi.fn().mockReturnValue([
          { id: 'task-a', dagStatus: 'running', description: 'Build API' },
        ]),
      },
    } as any;

    // Should not throw
    requestSecretaryDependencyAnalysis(ctx, 'lead-001', 'new-task', 'Deploy');
    expect(ctx.taskDAG.getTasks).not.toHaveBeenCalled();
  });

  it('skips when no active tasks exist', () => {
    const secretary = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'running', sendMessage: vi.fn(),
    };
    const ctx = {
      getAllAgents: vi.fn().mockReturnValue([secretary]),
      taskDAG: {
        getTasks: vi.fn().mockReturnValue([]),
      },
    } as any;

    requestSecretaryDependencyAnalysis(ctx, 'lead-001', 'new-task', 'Deploy');
    expect(secretary.sendMessage).not.toHaveBeenCalled();
  });

  it('excludes the new task from active tasks list', () => {
    const secretary = {
      id: 'sec-001', parentId: 'lead-001', role: { id: 'secretary' },
      status: 'running', sendMessage: vi.fn(),
    };
    const ctx = {
      getAllAgents: vi.fn().mockReturnValue([secretary]),
      taskDAG: {
        getTasks: vi.fn().mockReturnValue([
          { id: 'new-task', dagStatus: 'ready', description: 'Deploy API' },
          { id: 'other-task', dagStatus: 'pending', description: 'Build API' },
        ]),
      },
    } as any;

    requestSecretaryDependencyAnalysis(ctx, 'lead-001', 'new-task', 'Deploy the API');

    const msg = secretary.sendMessage.mock.calls[0][0];
    expect(msg).toContain('other-task');
    // new-task should not appear in the active tasks list (only in the header)
    const activeSection = msg.split('Active tasks:\n')[1]?.split('\n\nDoes')[0] || '';
    expect(activeSection).not.toContain('new-task');
    expect(activeSection).toContain('other-task');
  });
});

// ── DAG-aware group chat suggestions ──────────────────────────────────

describe('maybeSuggestDagGroup', () => {
  beforeEach(() => { suggestedGroupNames.clear(); });

  function makeGroupCtx(tasks: any[], existingGroups: any[] = []): { ctx: CommandHandlerContext; leadAgent: any } {
    const leadAgent = makeLeadAgent();
    const agents = new Map<string, any>([['lead-001', leadAgent]]);
    for (const t of tasks) {
      if (t.assignedAgentId && !agents.has(t.assignedAgentId)) {
        agents.set(t.assignedAgentId, {
          id: t.assignedAgentId,
          role: { id: t.role || 'developer', name: 'Developer' },
          status: 'running',
          sendMessage: vi.fn(),
        });
      }
    }
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTasks: vi.fn().mockReturnValue(tasks),
      },
      chatGroupRegistry: {
        getGroups: vi.fn().mockReturnValue(existingGroups),
      },
      getAgent: vi.fn().mockImplementation((id: string) => agents.get(id) || undefined),
    });
    return { ctx, leadAgent };
  }

  it('suggests group when 3+ agents share a keyword', () => {
    const tasks = [
      { id: 't1', dagStatus: 'running', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'running', assignedAgentId: 'agent-bbb', description: 'Review presentation flow', role: 'code-reviewer' },
      { id: 't3', dagStatus: 'running', assignedAgentId: 'agent-ccc', description: 'Polish presentation narrative', role: 'tech-writer' },
    ];
    const { ctx, leadAgent } = makeGroupCtx(tasks);

    maybeSuggestDagGroup(ctx, 'lead-001');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('presentation-team')
    );
    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('CREATE_GROUP')
    );
  });

  it('does not suggest when fewer than 3 agents', () => {
    const tasks = [
      { id: 't1', dagStatus: 'running', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'running', assignedAgentId: 'agent-bbb', description: 'Review presentation flow', role: 'code-reviewer' },
    ];
    const { ctx, leadAgent } = makeGroupCtx(tasks);

    maybeSuggestDagGroup(ctx, 'lead-001');

    expect(leadAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('does not suggest when group already exists', () => {
    const tasks = [
      { id: 't1', dagStatus: 'running', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'running', assignedAgentId: 'agent-bbb', description: 'Review presentation flow', role: 'code-reviewer' },
      { id: 't3', dagStatus: 'running', assignedAgentId: 'agent-ccc', description: 'Polish presentation narrative', role: 'tech-writer' },
    ];
    const existingGroups = [{ name: 'presentation-team', leadId: 'lead-001' }];
    const { ctx, leadAgent } = makeGroupCtx(tasks, existingGroups);

    maybeSuggestDagGroup(ctx, 'lead-001');

    expect(leadAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores done/skipped tasks', () => {
    const tasks = [
      { id: 't1', dagStatus: 'done', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'running', assignedAgentId: 'agent-bbb', description: 'Review presentation flow', role: 'code-reviewer' },
      { id: 't3', dagStatus: 'running', assignedAgentId: 'agent-ccc', description: 'Polish presentation narrative', role: 'tech-writer' },
    ];
    const { ctx, leadAgent } = makeGroupCtx(tasks);

    maybeSuggestDagGroup(ctx, 'lead-001');

    // Only 2 active agents — not enough for suggestion
    expect(leadAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores tasks without assigned agents', () => {
    const tasks = [
      { id: 't1', dagStatus: 'running', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'ready', assignedAgentId: undefined, description: 'Review presentation flow', role: 'code-reviewer' },
      { id: 't3', dagStatus: 'running', assignedAgentId: 'agent-ccc', description: 'Polish presentation narrative', role: 'tech-writer' },
    ];
    const { ctx, leadAgent } = makeGroupCtx(tasks);

    maybeSuggestDagGroup(ctx, 'lead-001');

    expect(leadAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('includes member names in suggestion', () => {
    const tasks = [
      { id: 't1', dagStatus: 'running', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'running', assignedAgentId: 'agent-bbb', description: 'Review presentation flow', role: 'code-reviewer' },
      { id: 't3', dagStatus: 'running', assignedAgentId: 'agent-ccc', description: 'Polish presentation narrative', role: 'tech-writer' },
    ];
    const { ctx, leadAgent } = makeGroupCtx(tasks);

    maybeSuggestDagGroup(ctx, 'lead-001');

    const msg = leadAgent.sendMessage.mock.calls[0][0];
    expect(msg).toContain('agent-aa');
    expect(msg).toContain('agent-bb');
    expect(msg).toContain('agent-cc');
    expect(msg).toContain('System suggestion');
  });

  it('does not re-suggest after lead ignores first suggestion', () => {
    suggestedGroupNames.clear();
    const tasks = [
      { id: 't1', dagStatus: 'running', assignedAgentId: 'agent-aaa', description: 'Write presentation slides', role: 'developer' },
      { id: 't2', dagStatus: 'running', assignedAgentId: 'agent-bbb', description: 'Review presentation flow', role: 'code-reviewer' },
      { id: 't3', dagStatus: 'running', assignedAgentId: 'agent-ccc', description: 'Polish presentation narrative', role: 'tech-writer' },
    ];
    const { ctx, leadAgent } = makeGroupCtx(tasks);

    // First call — should suggest
    maybeSuggestDagGroup(ctx, 'lead-001');
    expect(leadAgent.sendMessage).toHaveBeenCalledTimes(1);

    leadAgent.sendMessage.mockClear();

    // Second call — should NOT re-suggest (already suggested)
    maybeSuggestDagGroup(ctx, 'lead-001');
    expect(leadAgent.sendMessage).not.toHaveBeenCalled();
  });
});

describe('Duplicate detection applies role filter', () => {
  it('does not flag as duplicate when roles differ', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Existing task for 'architect' role with same description
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'existing-arch-task',
      role: 'architect',
      title: 'Fix the login bug',
      description: 'Fix the login bug in the auth module',
      dagStatus: 'running',
      dependsOn: [],
      files: [],
    }]);

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // Creating a 'developer' task with same description should NOT match the 'architect' task
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in the auth module"} ⟧⟧');

    // Should auto-create, not link to the architect's task
    expect(ctx.taskDAG.addTask).toHaveBeenCalled();
  });

  it('correctly deduplicates when role and description match with high similarity', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Existing task for same role with identical description
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'existing-dev-task',
      role: 'developer',
      title: 'Fix the login bug',
      description: 'Fix the login bug in the auth module',
      dagStatus: 'ready',
      dependsOn: [],
      files: [],
    }]);
    (ctx.taskDAG.startTask as any).mockReturnValue({ id: 'existing-dev-task', dagStatus: 'running' });

    const agent = makeLeadAgent();
    const cmd = getCreateAgentHandler(ctx);

    // Identical description → >0.95 similarity → should link
    cmd.handler(agent, '⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix the login bug in the auth module"} ⟧⟧');

    expect(ctx.taskDAG.addTask).not.toHaveBeenCalled();
    expect(child.dagTaskId).toBe('existing-dev-task');
  });
});

describe('Missing dagTaskId emits warning when DAG exists', () => {
  it('warns when DELEGATE without dagTaskId and DAG exists', () => {
    const child = makeChildAgent('lead-001');
    const ctx = makeCtx({ spawnAgent: vi.fn().mockReturnValue(child) });
    // Simulate existing DAG tasks
    (ctx.taskDAG.getTasks as any).mockReturnValue([{
      id: 'existing-task',
      role: 'designer',
      title: 'Design mockups',
      description: 'Design mockups for the UI',
      dagStatus: 'done',
      dependsOn: [],
      files: [],
    }]);
    (ctx.getAllAgents as any).mockReturnValue([child, {
      id: 'target-agent',
      parentId: 'lead-001',
      role: { id: 'developer', name: 'Developer' },
      status: 'idle',
      task: undefined,
      dagTaskId: undefined,
      sendMessage: vi.fn(),
      taskOutputStartIndex: 0,
      messages: [],
    }]);

    const agent = makeLeadAgent();
    const cmds = getLifecycleCommands(ctx);
    const delegateCmd = cmds.find(c => c.name === 'DELEGATE');
    if (!delegateCmd) throw new Error('DELEGATE not found');

    delegateCmd.handler(agent, '⟦⟦ DELEGATE {"to": "target-agent", "task": "Build the API"} ⟧⟧');

    // Should contain dagTaskId tip
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('dagTaskId'));
  });
});

describe('Review dependency inference finds all matching tasks', () => {
  it('finds ALL tasks matching reviewed role (Strategy 3)', () => {
    const ctx = makeCtx();
    // Set up multiple developer tasks
    (ctx.taskDAG.getTasks as any).mockReturnValue([
      { id: 'dev-task-1', role: 'developer', dagStatus: 'done', assignedAgentId: 'agent-1', dependsOn: [], files: [] },
      { id: 'dev-task-2', role: 'developer', dagStatus: 'running', assignedAgentId: 'agent-2', dependsOn: [], files: [] },
      { id: 'dev-task-3', role: 'developer', dagStatus: 'done', assignedAgentId: 'agent-3', dependsOn: [], files: [] },
    ]);

    const deps = inferReviewDependencies(ctx as any, 'lead-001', "Review work from the developer's output");

    // Should find ALL developer tasks, not just one
    expect(deps).toContain('dev-task-1');
    expect(deps).toContain('dev-task-2');
    expect(deps).toContain('dev-task-3');
    expect(deps.length).toBe(3);
  });

  it('Strategy 4: "review all work" depends on all running/done tasks', () => {
    const ctx = makeCtx();
    (ctx.taskDAG.getTasks as any).mockReturnValue([
      { id: 'task-a', role: 'developer', dagStatus: 'done', assignedAgentId: 'a1', dependsOn: [], files: [] },
      { id: 'task-b', role: 'designer', dagStatus: 'running', assignedAgentId: 'a2', dependsOn: [], files: [] },
      { id: 'task-c', role: 'architect', dagStatus: 'pending', assignedAgentId: 'a3', dependsOn: [], files: [] },
    ]);

    const deps = inferReviewDependencies(ctx as any, 'lead-001', 'Review all completed work');

    expect(deps).toContain('task-a');
    expect(deps).toContain('task-b');
    expect(deps).not.toContain('task-c'); // pending tasks excluded
  });

  it('normalizes plural role names in Strategy 3 (e.g., "developers" → "developer")', () => {
    const ctx = makeCtx();
    (ctx.taskDAG.getTasks as any).mockReturnValue([
      { id: 'dev-task-1', role: 'developer', dagStatus: 'done', assignedAgentId: 'agent-1', dependsOn: [], files: [] },
      { id: 'dev-task-2', role: 'developer', dagStatus: 'done', assignedAgentId: 'agent-2', dependsOn: [], files: [] },
    ]);

    const deps = inferReviewDependencies(ctx as any, 'lead-001', 'Review work from the developers');

    expect(deps).toContain('dev-task-1');
    expect(deps).toContain('dev-task-2');
    expect(deps.length).toBe(2);
  });
});
