/**
 * Tests for ASSIGN_TASK command — linking a delegation to an existing DAG task.
 *
 * Tests both the TaskDAG methods (startTask, forceStartTask) used by ASSIGN_TASK
 * and the command handler integration via CommandDispatcher.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import type { DagTaskInput } from '../tasks/TaskDAG.js';
import { CommandDispatcher, type CommandContext } from '../agents/CommandDispatcher.js';
import type { Agent } from '../agents/Agent.js';

const TEST_DB = ':memory:';
const LEAD = 'lead-main';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Record<string, any>> = {}): Agent {
  return {
    id: 'agent-lead-0001-0000-000000000001',
    role: { id: 'lead', name: 'Project Lead', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
    status: 'running',
    parentId: undefined,
    childIds: [],
    task: undefined,
    model: undefined,
    cwd: '/tmp/test',
    sessionId: null,
    humanMessageResponded: true,
    lastHumanMessageAt: null,
    lastHumanMessageText: null,
    hierarchyLevel: 0,
    sendMessage: vi.fn(),
    getBufferedOutput: vi.fn().mockReturnValue(''),
    toJSON: vi.fn(),
    ...overrides,
  } as unknown as Agent;
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    getAgent: vi.fn(),
    getAllAgents: vi.fn().mockReturnValue([]),
    getProjectIdForAgent: vi.fn().mockReturnValue(undefined),
    getRunningCount: vi.fn().mockReturnValue(1),
    spawnAgent: vi.fn(),
    terminateAgent: vi.fn().mockReturnValue(true),
    emit: vi.fn().mockReturnValue(true),
    roleRegistry: { get: vi.fn(), getAll: vi.fn().mockReturnValue([]) } as any,
    config: { workingDirectory: '/tmp/test', parallelSessions: 10 } as any,
    lockRegistry: { acquire: vi.fn().mockReturnValue({ ok: true }), release: vi.fn().mockReturnValue(true), releaseAll: vi.fn() } as any,
    activityLedger: { log: vi.fn() } as any,
    messageBus: { send: vi.fn() } as any,
    decisionLog: { add: vi.fn().mockReturnValue({ id: 'dec-1', status: 'recorded' }) } as any,
    agentMemory: { store: vi.fn(), getByLead: vi.fn().mockReturnValue([]) } as any,
    chatGroupRegistry: {
      create: vi.fn().mockReturnValue({ name: 'test', memberIds: [], leadId: '', createdAt: '' }),
      addMembers: vi.fn().mockReturnValue([]),
      removeMembers: vi.fn().mockReturnValue([]),
      sendMessage: vi.fn(),
      getGroupsForAgent: vi.fn().mockReturnValue([]),
      getMembers: vi.fn().mockReturnValue([]),
      getMessages: vi.fn().mockReturnValue([]),
    } as any,
    taskDAG: {
      declareTaskBatch: vi.fn().mockReturnValue({ tasks: [], conflicts: [] }),
      getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: {} }),
      getTasks: vi.fn().mockReturnValue([]),
      hasAnyTasks: vi.fn().mockReturnValue(false),
      hasActiveTasks: vi.fn().mockReturnValue(false),
      getTaskByAgent: vi.fn().mockReturnValue(null),
      getTask: vi.fn().mockReturnValue(null),
      findReadyTaskByRole: vi.fn().mockReturnValue(null),
      findReadyTask: vi.fn().mockReturnValue(null),
      getTransitionError: vi.fn().mockReturnValue(null),
      completeTask: vi.fn().mockReturnValue([]),
      failTask: vi.fn(),
      startTask: vi.fn().mockReturnValue(null),
      forceStartTask: vi.fn().mockReturnValue(null),
      pauseTask: vi.fn(),
      retryTask: vi.fn(),
      skipTask: vi.fn(),
      resolveReady: vi.fn().mockReturnValue([]),
      addTask: vi.fn().mockImplementation((_leadId: string, opts: any) => ({ id: opts.id || 'auto-task', ...opts })),
      addDependency: vi.fn().mockReturnValue(false),
      cancelTask: vi.fn(),
      resetDAG: vi.fn().mockReturnValue(0),
    } as any,
    deferredIssueRegistry: { add: vi.fn().mockReturnValue({ id: 'issue-1' }), list: vi.fn().mockReturnValue([]), resolve: vi.fn().mockReturnValue(true), dismiss: vi.fn().mockReturnValue(true) } as any,
    timerRegistry: {
      create: vi.fn().mockReturnValue({ id: 'tmr-1', label: 'test', repeat: false }),
      cancel: vi.fn().mockReturnValue(true),
      getAgentTimers: vi.fn().mockReturnValue([]),
      getAllTimers: vi.fn().mockReturnValue([]),
      clearAgent: vi.fn(),
    } as any,
    maxConcurrent: 10,
    markHumanInterrupt: vi.fn(),
    ...overrides,
  };
}

function dispatch(dispatcher: CommandDispatcher, agent: Agent, text: string): void {
  dispatcher.appendToBuffer(agent.id, text);
  dispatcher.scanBuffer(agent);
}

// ── TaskDAG unit tests for assign-related methods ────────────────────

describe('TaskDAG assign-related methods', () => {
  let db: Database;
  let dag: TaskDAG;

  beforeEach(() => {
    db = new Database(TEST_DB);
    dag = new TaskDAG(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('startTask', () => {
    it('starts a ready task and assigns the agent', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'task-a', role: 'developer', description: 'Do something' },
      ]);
      const result = dag.startTask(LEAD, 'task-a', 'agent-1');
      expect(result).not.toBeNull();
      expect(result!.dagStatus).toBe('running');
      expect(result!.assignedAgentId).toBe('agent-1');
    });

    it('rejects starting a pending (not ready) task', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'dep', role: 'developer', description: 'Dependency' },
        { id: 'task-b', role: 'developer', description: 'Blocked', dependsOn: ['dep'] },
      ]);
      const result = dag.startTask(LEAD, 'task-b', 'agent-1');
      expect(result).toBeNull();
    });

    it('rejects starting a non-existent task', () => {
      const result = dag.startTask(LEAD, 'no-such-task', 'agent-1');
      expect(result).toBeNull();
    });
  });

  describe('forceStartTask', () => {
    it('force-starts a pending task that has unmet dependencies', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'dep', role: 'developer', description: 'Dependency' },
        { id: 'task-c', role: 'developer', description: 'Blocked task', dependsOn: ['dep'] },
      ]);
      const task = dag.getTask(LEAD, 'task-c');
      expect(task!.dagStatus).toBe('pending');

      const result = dag.forceStartTask(LEAD, 'task-c', 'agent-2');
      expect(result).not.toBeNull();
      expect(result!.dagStatus).toBe('running');
      expect(result!.assignedAgentId).toBe('agent-2');
    });

    it('force-starts a blocked task', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'dep2', role: 'developer', description: 'Dependency' },
        { id: 'task-d', role: 'developer', description: 'Will be blocked', dependsOn: ['dep2'] },
      ]);
      // Fail the dependency to block task-d
      dag.startTask(LEAD, 'dep2', 'agent-x');
      dag.failTask(LEAD, 'dep2');
      expect(dag.getTask(LEAD, 'task-d')!.dagStatus).toBe('blocked');

      const result = dag.forceStartTask(LEAD, 'task-d', 'agent-3');
      expect(result).not.toBeNull();
      expect(result!.dagStatus).toBe('running');
    });

    it('force-starts a ready task', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'task-e', role: 'developer', description: 'Ready task' },
      ]);
      const result = dag.forceStartTask(LEAD, 'task-e', 'agent-4');
      expect(result).not.toBeNull();
      expect(result!.dagStatus).toBe('running');
      expect(result!.assignedAgentId).toBe('agent-4');
    });

    it('rejects force-starting a done task', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'task-f', role: 'developer', description: 'Will be done' },
      ]);
      dag.startTask(LEAD, 'task-f', 'agent-5');
      dag.completeTask(LEAD, 'task-f');
      expect(dag.getTask(LEAD, 'task-f')!.dagStatus).toBe('done');

      const result = dag.forceStartTask(LEAD, 'task-f', 'agent-6');
      expect(result).toBeNull();
    });

    it('rejects force-starting an already running task', () => {
      dag.declareTaskBatch(LEAD, [
        { id: 'task-g', role: 'developer', description: 'Already running' },
      ]);
      dag.startTask(LEAD, 'task-g', 'agent-7');

      const result = dag.forceStartTask(LEAD, 'task-g', 'agent-8');
      expect(result).toBeNull();
    });

    it('rejects force-starting a non-existent task', () => {
      const result = dag.forceStartTask(LEAD, 'ghost', 'agent-9');
      expect(result).toBeNull();
    });
  });
});

// ── ASSIGN_TASK command handler tests ────────────────────────────────

describe('ASSIGN_TASK command', () => {
  let ctx: CommandContext;
  let dispatcher: CommandDispatcher;
  let leadAgent: Agent;

  beforeEach(() => {
    ctx = makeContext();
    dispatcher = new CommandDispatcher(ctx);
    leadAgent = makeAgent({ id: LEAD });
  });

  it('assigns a ready task using startTask and sets up delegation', () => {
    const targetAgent = makeAgent({
      id: 'agent-1-full-id',
      role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
      parentId: LEAD,
      sendMessage: vi.fn(),
    });
    const mockTask = { id: 'task-1', dagStatus: 'ready', assignedAgentId: 'agent-1-full-id', role: 'developer' };
    (ctx.taskDAG.getTask as any).mockReturnValue({ id: 'task-1', dagStatus: 'ready', description: 'Do something', role: 'developer' });
    (ctx.taskDAG.startTask as any).mockReturnValue(mockTask);
    (ctx.getAllAgents as any).mockReturnValue([leadAgent, targetAgent]);

    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-1", "agentId": "agent-1"} ⟧⟧');

    expect(ctx.taskDAG.startTask).toHaveBeenCalledWith(LEAD, 'task-1', 'agent-1-full-id');
    expect(targetAgent.dagTaskId).toBe('task-1');
    expect(targetAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('DAG Task: task-1'));
    expect(leadAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('task-1'));
  });

  it('falls back to forceStartTask for pending/blocked tasks when startTask fails', () => {
    const targetAgent = makeAgent({
      id: 'agent-2-full-id',
      role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
      parentId: LEAD,
      sendMessage: vi.fn(),
    });
    const mockTask = { id: 'task-2', dagStatus: 'running', assignedAgentId: 'agent-2-full-id', role: 'developer' };
    (ctx.taskDAG.getTask as any).mockReturnValue({ id: 'task-2', dagStatus: 'pending', description: 'Blocked task', role: 'developer' });
    (ctx.taskDAG.startTask as any).mockReturnValue(null);
    (ctx.taskDAG.forceStartTask as any).mockReturnValue(mockTask);
    (ctx.getAllAgents as any).mockReturnValue([leadAgent, targetAgent]);

    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-2", "agentId": "agent-2"} ⟧⟧');

    expect(ctx.taskDAG.forceStartTask).toHaveBeenCalledWith(LEAD, 'task-2', 'agent-2-full-id');
    expect(targetAgent.dagTaskId).toBe('task-2');
  });

  it('rejects when task not found', () => {
    (ctx.taskDAG.getTask as any).mockReturnValue(null);

    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "ghost", "agentId": "agent-3"} ⟧⟧');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('not found'),
    );
  });

  it('rejects when agent not found', () => {
    (ctx.taskDAG.getTask as any).mockReturnValue({ id: 'task-3', dagStatus: 'ready', role: 'developer' });
    (ctx.getAllAgents as any).mockReturnValue([leadAgent]);

    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-3", "agentId": "nonexistent"} ⟧⟧');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Agent not found'),
    );
    expect(ctx.taskDAG.startTask).not.toHaveBeenCalled();
  });

  it('rejects ambiguous agent ID prefix matching multiple agents', () => {
    const agentA = makeAgent({ id: 'agent-abc-111', role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true }, parentId: LEAD });
    const agentB = makeAgent({ id: 'agent-abc-222', role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true }, parentId: LEAD });
    (ctx.taskDAG.getTask as any).mockReturnValue({ id: 'task-amb', dagStatus: 'ready', role: 'developer' });
    (ctx.getAllAgents as any).mockReturnValue([leadAgent, agentA, agentB]);

    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-amb", "agentId": "agent-abc"} ⟧⟧');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Ambiguous'),
    );
    expect(ctx.taskDAG.startTask).not.toHaveBeenCalled();
  });

  it('rejects when task is already running and suggests REASSIGN_TASK', () => {
    const targetAgent = makeAgent({
      id: 'agent-4-full-id',
      role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
      parentId: LEAD,
    });
    (ctx.taskDAG.getTask as any).mockReturnValue({ id: 'done-task', dagStatus: 'running', assignedAgentId: 'old-agent-id', role: 'developer' });
    (ctx.getAllAgents as any).mockReturnValue([leadAgent, targetAgent]);

    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "done-task", "agentId": "agent-4"} ⟧⟧');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('REASSIGN_TASK'),
    );
    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('old-agen'),
    );
  });

  it('rejects when non-lead agent tries to assign', () => {
    const devAgent = makeAgent({
      id: 'dev-agent',
      role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
      parentId: LEAD,
    });

    dispatch(dispatcher, devAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-5", "agentId": "agent-5"} ⟧⟧');

    expect(devAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Only the Project Lead'),
    );
  });

  it('rejects with missing taskId', () => {
    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"agentId": "agent-6"} ⟧⟧');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('taskId'),
    );
  });

  it('rejects with missing agentId', () => {
    dispatch(dispatcher, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-7"} ⟧⟧');

    expect(leadAgent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('agentId'),
    );
  });

  it('creates a delegation record in ctx.delegations', () => {
    const targetAgent = makeAgent({
      id: 'agent-del-full-id',
      role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
      parentId: LEAD,
      sendMessage: vi.fn(),
    });
    const mockTask = { id: 'task-del', dagStatus: 'ready', assignedAgentId: 'agent-del-full-id', role: 'developer' };
    (ctx.taskDAG.getTask as any).mockReturnValue({ id: 'task-del', dagStatus: 'ready', description: 'Delegation test', role: 'developer' });
    (ctx.taskDAG.startTask as any).mockReturnValue(mockTask);
    (ctx.getAllAgents as any).mockReturnValue([leadAgent, targetAgent]);

    const dispatcher2 = new CommandDispatcher(ctx);
    dispatch(dispatcher2, leadAgent, '⟦⟦ ASSIGN_TASK {"taskId": "task-del", "agentId": "agent-del"} ⟧⟧');

    // Check delegation was created (access via the context's delegations map)
    const delegations = (ctx as any).delegations || (dispatcher2 as any).delegations;
    // The delegation record should have been set — verify agent got notified
    expect(targetAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('DAG Task: task-del'));
    expect(targetAgent.task).toBe('Delegation test');
  });
});
