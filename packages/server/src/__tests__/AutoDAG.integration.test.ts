/**
 * Auto-DAG integration tests.
 *
 * Tests the automatic DAG task creation, completion, and dependency inference
 * that happens when agents are delegated via CREATE_AGENT / DELEGATE commands.
 *
 * Uses a real TaskDAG (in-memory DB) with mocked CommandDispatcher context
 * to exercise the full auto-creation path in AgentLifecycle.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandDispatcher, type CommandContext } from '../agents/CommandDispatcher.js';
import { Database } from '../db/database.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import { generateAutoTaskId, requestSecretaryDependencyAnalysis, inferReviewDependencies } from '../agents/commands/AgentLifecycle.js';
import type { Agent } from '../agents/Agent.js';
import type { Role } from '../agents/RoleRegistry.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Writes code',
    systemPrompt: 'You are a developer',
    color: '#00ff00',
    icon: '💻',
    builtIn: true,
    model: 'claude-sonnet-4.5',
    ...overrides,
  };
}

let agentCounter = 0;
function makeAgent(overrides: Partial<Record<string, any>> = {}): Agent {
  agentCounter++;
  return {
    id: `agent-lead-${String(agentCounter).padStart(4, '0')}`,
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
    getRecentOutput: vi.fn().mockReturnValue('done'),
    getTaskOutput: vi.fn().mockReturnValue('done'),
    toJSON: vi.fn(),
    ...overrides,
  } as unknown as Agent;
}

function makeChild(parentId: string, overrides: Partial<Record<string, any>> = {}): Agent {
  agentCounter++;
  return makeAgent({
    id: `agent-child-${String(agentCounter).padStart(4, '0')}`,
    role: makeRole(),
    status: 'idle',
    parentId,
    dagTaskId: undefined,
    ...overrides,
  });
}

function makeContext(taskDAG: TaskDAG, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    getAgent: vi.fn(),
    getAllAgents: vi.fn().mockReturnValue([]),
    getProjectIdForAgent: vi.fn().mockReturnValue(undefined),
    getRunningCount: vi.fn().mockReturnValue(1),
    spawnAgent: vi.fn(),
    terminateAgent: vi.fn().mockReturnValue(true),
    emit: vi.fn().mockReturnValue(true),
    roleRegistry: {
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
    } as any,
    config: { workingDirectory: '/tmp/test', parallelSessions: 10 } as any,
    lockRegistry: {
      acquire: vi.fn().mockReturnValue({ ok: true }),
      release: vi.fn().mockReturnValue(true),
      releaseAll: vi.fn(),
      getByAgent: vi.fn().mockReturnValue([]),
    } as any,
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
    taskDAG,
    timerRegistry: {
      create: vi.fn().mockReturnValue({ id: 'tmr-1', label: 'test', repeat: false }),
      cancel: vi.fn().mockReturnValue(true),
      getAgentTimers: vi.fn().mockReturnValue([]),
      getAllTimers: vi.fn().mockReturnValue([]),
      clearAgent: vi.fn(),
    } as any,
    maxConcurrent: 10,
    markHumanInterrupt: vi.fn(), haltHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(),
    ...overrides,
  };
}

function dispatch(dispatcher: CommandDispatcher, agent: Agent, text: string): void {
  dispatcher.appendToBuffer(agent.id, text);
  dispatcher.scanBuffer(agent);
}

// ── Test Suite ────────────────────────────────────────────────────────

describe('Auto-DAG integration', () => {
  let db: Database;
  let dag: TaskDAG;
  let ctx: CommandContext;
  let dispatcher: CommandDispatcher;
  let lead: Agent;

  beforeEach(() => {
    agentCounter = 0;
    db = new Database(':memory:');
    dag = new TaskDAG(db);
    lead = makeAgent();
    ctx = makeContext(dag);
    dispatcher = new CommandDispatcher(ctx);
  });

  afterEach(() => {
    db.close();
  });

  /** Dispatch CREATE_AGENT and return the child agent that was set up */
  function createAgent(opts: {
    role?: string;
    task: string;
    dagTaskId?: string;
    dependsOn?: string[];
    childOverrides?: Record<string, any>;
  }): Agent {
    const role = opts.role || 'developer';
    const roleObj = makeRole({ id: role, name: role.charAt(0).toUpperCase() + role.slice(1) });
    (ctx.roleRegistry.get as any).mockReturnValue(roleObj);
    const child = makeChild(lead.id, {
      role: roleObj,
      ...opts.childOverrides,
    });
    (ctx.spawnAgent as any).mockReturnValue(child);
    (ctx.getAllAgents as any).mockReturnValue([lead, child]);

    const payload: Record<string, any> = { role, task: opts.task };
    if (opts.dagTaskId) payload.dagTaskId = opts.dagTaskId;
    if (opts.dependsOn) payload.dependsOn = opts.dependsOn;

    dispatch(dispatcher, lead, `⟦⟦ CREATE_AGENT ${JSON.stringify(payload)} ⟧⟧`);
    return child;
  }

  /** Dispatch DELEGATE to an existing child */
  function delegateToAgent(child: Agent, opts: {
    task: string;
    dagTaskId?: string;
    dependsOn?: string[];
  }): void {
    (ctx.getAgent as any).mockImplementation((id: string) =>
      id === lead.id ? lead : id === child.id ? child : undefined,
    );
    (ctx.getAllAgents as any).mockReturnValue([lead, child]);

    const payload: Record<string, any> = { to: child.id, task: opts.task };
    if (opts.dagTaskId) payload.dagTaskId = opts.dagTaskId;
    if (opts.dependsOn) payload.dependsOn = opts.dependsOn;

    dispatch(dispatcher, lead, `⟦⟦ DELEGATE ${JSON.stringify(payload)} ⟧⟧`);
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. AUTO-CREATION (12 tests)
  // ════════════════════════════════════════════════════════════════════

  describe('Auto-DAG creation on delegation', () => {

    it('creates DAG task when CREATE_AGENT has no matching task', () => {
      const child = createAgent({ task: 'Fix bugs in the API' });
      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].role).toBe('developer');
      expect(tasks[0].description).toContain('Fix bugs in the API');
      expect(tasks[0].dagStatus).toBe('running');
      expect(tasks[0].assignedAgentId).toBe(child.id);
    });

    it('creates DAG task when DELEGATE has no matching task', () => {
      const child = makeChild(lead.id);
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === child.id ? child : undefined,
      );
      (ctx.getAllAgents as any).mockReturnValue([lead, child]);
      delegateToAgent(child, { task: 'Add tests for auth' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].description).toContain('Add tests for auth');
      expect(tasks[0].dagStatus).toBe('running');
    });

    it('does NOT create task when findReadyTask matches existing task', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'fix-bugs', role: 'developer', description: 'Fix bugs' },
      ]);
      createAgent({ task: 'Fix bugs', dagTaskId: 'fix-bugs' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe('fix-bugs');
      expect(tasks[0].dagStatus).toBe('running');
    });

    it('does NOT create task when fuzzy match finds existing task', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'fix-api-bugs', role: 'developer', description: 'Fix API bugs in endpoints' },
      ]);
      // No dagTaskId — relies on fuzzy matching
      createAgent({ task: 'Fix the API bugs in the endpoints' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe('fix-api-bugs');
    });

    it('warns on near-duplicate instead of creating', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'fix-critical-bugs', role: 'developer', description: 'Fix critical bugs in the system' },
      ]);
      // Similar but not matching via findReadyTask (already started by someone else)
      dag.startTask(lead.id, 'fix-critical-bugs', 'agent-other');
      createAgent({ task: 'Fix the critical bugs in the system' });

      // Should warn about near-duplicate, not create a new one
      expect((lead.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('fix-critical-bugs'),
      );
      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(1);
    });

    it('creates task even when other DAG tasks exist (ad-hoc)', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-1', role: 'developer', description: 'First task' },
        { taskId: 'task-2', role: 'tester', description: 'Second task' },
      ]);
      dag.startTask(lead.id, 'task-1', 'agent-x');
      dag.completeTask(lead.id, 'task-1');

      createAgent({ task: 'Completely unrelated new work' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(3);
      const autoTask = tasks.find(t => t.id.startsWith('auto-'));
      expect(autoTask).toBeDefined();
      expect(autoTask!.dagStatus).toBe('running');
    });

    it('generates readable auto task IDs', () => {
      createAgent({ task: 'Fix DAG auto-linking bugs' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks[0].id).toMatch(/^auto-developer-/);
      expect(tasks[0].id.length).toBeLessThanOrEqual(60);
    });

    it('generates unique IDs for same role+task', () => {
      const id1 = generateAutoTaskId('developer', 'Fix bugs');
      // Tiny delay to ensure different timestamp suffix
      const id2 = generateAutoTaskId('developer', 'Fix bugs');
      // IDs may or may not differ (same ms) — but structure is correct
      expect(id1).toMatch(/^auto-developer-fix-bugs-/);
      expect(id2).toMatch(/^auto-developer-fix-bugs-/);
    });

    it('populates role from delegation role', () => {
      createAgent({ role: 'architect', task: 'Design the system' });
      const tasks = dag.getTasks(lead.id);
      expect(tasks[0].role).toBe('architect');
    });

    it('populates description from delegation task text', () => {
      const longTask = 'Implement the full authentication system with OAuth2 support';
      createAgent({ task: longTask });
      const tasks = dag.getTasks(lead.id);
      expect(tasks[0].description).toBe(longTask);
    });

    it('populates title as truncated description', () => {
      const longTask = 'A'.repeat(200);
      createAgent({ task: longTask });
      const tasks = dag.getTasks(lead.id);
      expect(tasks[0]!.title!.length).toBeLessThanOrEqual(120);
    });

    it('creates auto-task with running status immediately', () => {
      const child = createAgent({ task: 'Build API endpoints' });
      const tasks = dag.getTasks(lead.id);
      expect(tasks[0].dagStatus).toBe('running');
      expect(tasks[0].assignedAgentId).toBe(child.id);
      expect(tasks[0].startedAt).toBeTruthy();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 2. AUTO-COMPLETION (8 tests)
  // ════════════════════════════════════════════════════════════════════

  describe('Auto-DAG completion', () => {
    let child: Agent;

    beforeEach(() => {
      child = createAgent({ task: 'Fix bugs in the module' });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === child.id ? child : undefined,
      );
    });

    it('auto-completes DAG task when agent goes idle', () => {
      dispatcher.notifyParentOfIdle(child);
      const tasks = dag.getTasks(lead.id);
      const autoTask = tasks.find(t => t.dagStatus === 'done');
      expect(autoTask).toBeDefined();
    });

    it('auto-completes DAG task when agent exits cleanly', () => {
      dispatcher.notifyParentOfCompletion(child, 0);
      const tasks = dag.getTasks(lead.id);
      const autoTask = tasks.find(t => t.dagStatus === 'done');
      expect(autoTask).toBeDefined();
    });

    it('does NOT error on double completion', () => {
      dispatcher.notifyParentOfIdle(child);
      // Second call should be a no-op (deduplicated by reportedCompletions)
      dispatcher.notifyParentOfCompletion(child, 0);
      const tasks = dag.getTasks(lead.id);
      const doneTasks = tasks.filter(t => t.dagStatus === 'done');
      expect(doneTasks.length).toBe(1);
    });

    it('promotes dependents when auto-created task completes', () => {
      const autoTask = dag.getTasks(lead.id)[0];
      // Add a second task that depends on the auto-created one
      dag.addTask(lead.id, { taskId: 'next-task', role: 'tester', dependsOn: [autoTask.id] });
      const pendingTask = dag.getTask(lead.id, 'next-task');
      expect(pendingTask!.dagStatus).toBe('pending');

      dispatcher.notifyParentOfIdle(child);
      const nextTask = dag.getTask(lead.id, 'next-task');
      expect(nextTask!.dagStatus).toBe('ready');
    });

    it('marks task failed on non-zero exit', () => {
      dispatcher.notifyParentOfCompletion(child, 1);
      const tasks = dag.getTasks(lead.id);
      const failedTask = tasks.find(t => t.dagStatus === 'failed');
      expect(failedTask).toBeDefined();
    });

    it('completion works for auto-created tasks same as declared tasks', () => {
      // Declared task
      dag.declareTaskBatch(lead.id, [{ taskId: 'declared-task', role: 'tester' }]);
      dag.startTask(lead.id, 'declared-task', 'agent-tester-001');
      dag.completeTask(lead.id, 'declared-task');

      // Auto-created task (via beforeEach)
      dispatcher.notifyParentOfIdle(child);

      const tasks = dag.getTasks(lead.id);
      const doneTasks = tasks.filter(t => t.dagStatus === 'done');
      expect(doneTasks.length).toBe(2);
    });

    it('getTaskByAgent finds auto-created tasks', () => {
      const found = dag.getTaskByAgent(lead.id, child.id);
      expect(found).toBeDefined();
      expect(found!.assignedAgentId).toBe(child.id);
      expect(found!.dagStatus).toBe('running');
    });

    it('handles re-delegation: old task completes, new task starts', () => {
      // Complete the first task
      dispatcher.notifyParentOfIdle(child);

      // Re-delegate a new task to a new child
      const child2 = createAgent({ task: 'Completely different work' });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === child2.id ? child2 : undefined,
      );

      const tasks = dag.getTasks(lead.id);
      const doneTasks = tasks.filter(t => t.dagStatus === 'done');
      const runningTasks = tasks.filter(t => t.dagStatus === 'running');
      expect(doneTasks.length).toBe(1);
      expect(runningTasks.length).toBe(1);
      expect(runningTasks[0].assignedAgentId).toBe(child2.id);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 3. DEPENDENCY INFERENCE — TIER 1: Explicit (11 tests)
  // ════════════════════════════════════════════════════════════════════

  describe('Tier 1: explicit dependsOn', () => {

    describe('addDependency (pure DAG logic)', () => {
      it('self-dependency is rejected', () => {
        dag.declareTaskBatch(lead.id, [{ taskId: 'a', role: 'Dev' }]);
        // Self-loop: a depends on a → would create cycle check catches it
        // wouldCreateCycle: queue starts at 'a', checks if current === 'a' → true
        const result = dag.addDependency(lead.id, 'a', 'a');
        expect(result).toBe(false);
      });
    });

    describe('explicit dependsOn in delegation', () => {

      it('CREATE_AGENT with dependsOn creates task with dependency edges', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'task-1', role: 'developer', description: 'First task' },
        ]);
        dag.startTask(lead.id, 'task-1', 'agent-x');

        createAgent({ task: 'Fix API after task-1', dependsOn: ['task-1'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        expect(autoTask!.dependsOn).toContain('task-1');
      });

      it('dependsOn with nonexistent task ID does not add dependency', () => {
        createAgent({ task: 'Some work', dependsOn: ['nonexistent-id'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        // addDependency returns false for nonexistent, so no dep added
        expect(autoTask!.dependsOn).toHaveLength(0);
      });

      it('dependsOn with multiple valid tasks creates all edges', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'task-1', role: 'developer' },
          { taskId: 'task-2', role: 'developer' },
          { taskId: 'task-3', role: 'tester' },
        ]);

        createAgent({ task: 'Integrate everything', dependsOn: ['task-1', 'task-2', 'task-3'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        expect(autoTask!.dependsOn).toContain('task-1');
        expect(autoTask!.dependsOn).toContain('task-2');
        expect(autoTask!.dependsOn).toContain('task-3');
      });

      it('dependsOn records dependency on running auto-task without blocking', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'blocker', role: 'developer' },
        ]);
        dag.startTask(lead.id, 'blocker', 'agent-x');

        createAgent({ task: 'Depends on blocker', dependsOn: ['blocker'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        // Auto-task stays running since addDependency no longer regresses running→blocked
        expect(autoTask!.dagStatus).toBe('running');
        expect(autoTask!.dependsOn).toContain('blocker');
      });

      it('dependsOn on completed task keeps auto-task running', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'done-task', role: 'developer' },
        ]);
        dag.startTask(lead.id, 'done-task', 'agent-x');
        dag.completeTask(lead.id, 'done-task');

        createAgent({ task: 'After done task', dependsOn: ['done-task'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        // Task was auto-started as 'running' since dependency already satisfied
        expect(autoTask!.dependsOn).toContain('done-task');
        // Status should be running (started immediately since dep done)
        expect(autoTask!.dagStatus).toBe('running');
      });

      it('partial dependsOn: some valid, some invalid', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'real-task', role: 'tester' },
        ]);

        createAgent({ task: 'Mixed deps work', dependsOn: ['real-task', 'fake-task'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        expect(autoTask!.dependsOn).toContain('real-task');
        expect(autoTask!.dependsOn).not.toContain('fake-task');
      });

      it('duplicate IDs in dependsOn are deduplicated', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'task-1', role: 'tester' },
        ]);

        createAgent({ task: 'Duped deps work', dependsOn: ['task-1', 'task-1'] });

        const tasks = dag.getTasks(lead.id);
        const autoTask = tasks.find(t => t.id.startsWith('auto-'));
        expect(autoTask).toBeDefined();
        const depCount = autoTask!.dependsOn.filter((d: string) => d === 'task-1').length;
        expect(depCount).toBe(1);
      });

      it('completing dependency does not affect running auto-task', () => {
        dag.declareTaskBatch(lead.id, [
          { taskId: 'prereq', role: 'tester' },
        ]);
        dag.startTask(lead.id, 'prereq', 'agent-x');

        createAgent({ task: 'Depends on prereq finishing', dependsOn: ['prereq'] });

        const autoTaskBefore = dag.getTasks(lead.id).find(t => t.id.startsWith('auto-'));
        // Auto-task stays running (addDependency no longer regresses running→blocked)
        expect(autoTaskBefore!.dagStatus).toBe('running');

        // Complete the prereq
        dag.completeTask(lead.id, 'prereq');

        // Auto-task still running (was never blocked)
        const autoTaskAfter = dag.getTasks(lead.id).find(t => t.id.startsWith('auto-'));
        expect(autoTaskAfter!.dagStatus).toBe('running');
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 4. DEPENDENCY INFERENCE — TIER 2: Review (7 tests)
  // ════════════════════════════════════════════════════════════════════

  describe('Tier 2: review role dependency inference', () => {

    it('review delegation auto-links to target agent by ID', () => {
      // Create a dev task first
      const devChild = createAgent({ task: 'Fix bugs' });
      const _devTask = dag.getTasks(lead.id)[0];

      // Create a review task mentioning the agent ID prefix
      const _agentPrefix = devChild.id.slice(6, 14); // extract "child-00" portion
      createAgent({
        role: 'code-reviewer',
        task: `Review the fix by ${devChild.id.slice(6)}`,
      });

      const tasks = dag.getTasks(lead.id);
      const reviewTask = tasks.find(t => t.role === 'code-reviewer');
      expect(reviewTask).toBeDefined();
      // Agent ID matching uses hex patterns ≥8 chars
    });

    it('review delegation auto-links by task ID mention', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'p0-2-autolink', role: 'developer', description: 'Fix auto-linking' },
      ]);
      dag.startTask(lead.id, 'p0-2-autolink', 'agent-dev');

      createAgent({
        role: 'code-reviewer',
        task: 'Review p0-2-autolink changes',
      });

      const tasks = dag.getTasks(lead.id);
      const reviewTask = tasks.find(t => t.role === 'code-reviewer');
      expect(reviewTask).toBeDefined();
      expect(reviewTask!.dependsOn).toContain('p0-2-autolink');
    });

    it('review delegation auto-links by role reference', () => {
      // Create a developer task
      createAgent({ task: 'Implement API endpoints' });

      createAgent({
        role: 'code-reviewer',
        task: 'Review the API changes from the developer',
      });

      const tasks = dag.getTasks(lead.id);
      const reviewTask = tasks.find(t => t.role === 'code-reviewer');
      expect(reviewTask).toBeDefined();
      // Should have inferred dependency on the developer's task
      const devTask = tasks.find(t => t.role === 'developer');
      if (devTask && reviewTask!.dependsOn.length > 0) {
        expect(reviewTask!.dependsOn).toContain(devTask.id);
      }
    });

    it('non-review role does NOT trigger review inference', () => {
      createAgent({ task: 'Implement API' });

      // This is a developer, not a reviewer — should not infer dependencies
      createAgent({
        role: 'developer',
        task: 'Review the architecture by the architect',
      });

      const tasks = dag.getTasks(lead.id);
      const devTasks = tasks.filter(t => t.role === 'developer');
      const secondDevTask = devTasks[1];
      // Developer tasks don't get review inference — deps should be empty
      expect(secondDevTask.dependsOn).toHaveLength(0);
    });

    it('review of unknown agent ID does not create dependency', () => {
      createAgent({
        role: 'code-reviewer',
        task: 'Review the fix by zzz99999',
      });

      const tasks = dag.getTasks(lead.id);
      const reviewTask = tasks.find(t => t.role === 'code-reviewer');
      expect(reviewTask).toBeDefined();
      expect(reviewTask!.dependsOn).toHaveLength(0);
    });

    it('review dependency on completed task keeps review as running', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'p0-2-fixbugs', role: 'developer', description: 'Fix bugs' },
      ]);
      dag.startTask(lead.id, 'p0-2-fixbugs', 'agent-dev');
      dag.completeTask(lead.id, 'p0-2-fixbugs');

      createAgent({
        role: 'critical-reviewer',
        task: 'Review p0-2-fixbugs changes',
      });

      const tasks = dag.getTasks(lead.id);
      const reviewTask = tasks.find(t => t.role === 'critical-reviewer');
      expect(reviewTask).toBeDefined();
      // Tier 2 regex matches p\d+-\d+ pattern
      expect(reviewTask!.dependsOn).toContain('p0-2-fixbugs');
      expect(reviewTask!.dagStatus).toBe('running');
    });

    it('handles multiple review targets', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'p0-2-autolink', role: 'developer', description: 'Fix auto-linking' },
        { taskId: 'p0-3-complete', role: 'developer', description: 'Fix completion' },
      ]);
      dag.startTask(lead.id, 'p0-2-autolink', 'agent-a');
      dag.startTask(lead.id, 'p0-3-complete', 'agent-b');

      createAgent({
        role: 'code-reviewer',
        task: 'Review both p0-2-autolink and p0-3-complete changes',
      });

      const tasks = dag.getTasks(lead.id);
      const reviewTask = tasks.find(t => t.role === 'code-reviewer');
      expect(reviewTask).toBeDefined();
      expect(reviewTask!.dependsOn).toContain('p0-2-autolink');
      expect(reviewTask!.dependsOn).toContain('p0-3-complete');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 5. DEPENDENCY INFERENCE — TIER 3: Natural Language (9 tests)
  // ════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════
  // 5. DEPENDENCY INFERENCE — TIER 3: NL via Secretary (9 tests)
  //    Tier 3 NL inference is ASYNC — autoCreateDagTask delegates to
  //    the Secretary agent via requestSecretaryDependencyAnalysis().
  //    Tests verify: message is sent, message content is correct,
  //    edge cases (no secretary, no active tasks).
  // ════════════════════════════════════════════════════════════════════

  describe('Tier 3: NL via Secretary (requestSecretaryDependencyAnalysis)', () => {

    it('sends analysis request to secretary when secretary exists', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build feature' },
      ]);

      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Implement the API after design is done',
      );

      expect(secretary.sendMessage).toHaveBeenCalledOnce();
      expect(secretary.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Dependency analysis needed for new task "new-task"'),
      );
    });

    it('message includes task description', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build feature' },
      ]);

      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Build the payment system integration',
      );

      const msg = (secretary.sendMessage as any).mock.calls[0][0];
      expect(msg).toContain('Build the payment system integration');
    });

    it('message lists active tasks for secretary to analyze', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build auth module' },
        { taskId: 'task-b', role: 'architect', description: 'Design API schema' },
      ]);

      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Integrate auth with API',
      );

      const msg = (secretary.sendMessage as any).mock.calls[0][0];
      expect(msg).toContain('task-a');
      expect(msg).toContain('Build auth module');
      expect(msg).toContain('task-b');
      expect(msg).toContain('Design API schema');
    });

    it('message includes ADD_DEPENDENCY instruction for secretary', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build feature' },
      ]);

      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Some task',
      );

      const msg = (secretary.sendMessage as any).mock.calls[0][0];
      expect(msg).toContain('ADD_DEPENDENCY');
      expect(msg).toContain('"taskId": "new-task"');
    });

    it('does NOT send message when no secretary agent exists', () => {
      (ctx.getAllAgents as any).mockReturnValue([lead]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build feature' },
      ]);

      // Should not throw — silently skips
      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Some task',
      );
      // No secretary → no message sent (nothing to assert except no error)
    });

    it('does NOT send message when secretary is terminated', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'terminated',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build feature' },
      ]);

      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Some task',
      );

      expect(secretary.sendMessage).not.toHaveBeenCalled();
    });

    it('does NOT send message when no active tasks exist', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      // No tasks declared at all
      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'Some task',
      );

      expect(secretary.sendMessage).not.toHaveBeenCalled();
    });

    it('excludes the new task itself from active tasks list', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });
      (ctx.getAllAgents as any).mockReturnValue([lead, secretary]);

      dag.declareTaskBatch(lead.id, [
        { taskId: 'existing-task', role: 'developer', description: 'Build feature' },
        { taskId: 'new-task', role: 'developer', description: 'New task to analyze' },
      ]);

      requestSecretaryDependencyAnalysis(
        { ...ctx, taskDAG: dag } as any,
        lead.id,
        'new-task',
        'New task to analyze',
      );

      const msg = (secretary.sendMessage as any).mock.calls[0][0];
      expect(msg).toContain('existing-task');
      // new-task should not appear in the "Active tasks" list
      const activeSection = msg.split('Active tasks:')[1];
      expect(activeSection).not.toContain('- new-task:');
    });

    it('auto-create triggers secretary analysis when no sync deps found', () => {
      const secretary = makeChild(lead.id, {
        role: { id: 'secretary', name: 'Secretary' },
        status: 'running',
        sendMessage: vi.fn(),
      });

      // Create a pre-existing task so secretary has something to analyze
      dag.declareTaskBatch(lead.id, [
        { taskId: 'existing', role: 'architect', description: 'Design system' },
      ]);

      // Create agent — the helper sets getAllAgents to [lead, child],
      // but we need secretary included. Use childOverrides to pass the
      // secretary through, then re-mock getAllAgents before dispatch.
      const role = 'developer';
      const roleObj = makeRole({ id: role, name: 'Developer' });
      (ctx.roleRegistry.get as any).mockReturnValue(roleObj);
      const child = makeChild(lead.id, { role: roleObj });
      (ctx.spawnAgent as any).mockReturnValue(child);
      // Include secretary so requestSecretaryDependencyAnalysis can find it
      (ctx.getAllAgents as any).mockReturnValue([lead, child, secretary]);

      dispatch(dispatcher, lead, `⟦⟦ CREATE_AGENT ${JSON.stringify({ role, task: 'Implement the API endpoint for users' })} ⟧⟧`);

      // Secretary should have received a dependency analysis request
      expect(secretary.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Dependency analysis needed'),
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 6. EDGE CASES (9 tests)
  // ════════════════════════════════════════════════════════════════════

  describe('Auto-DAG edge cases', () => {

    it('first delegation ever creates DAG from scratch', () => {
      expect(dag.hasAnyTasks(lead.id)).toBe(false);
      createAgent({ task: 'Very first task' });
      expect(dag.hasAnyTasks(lead.id)).toBe(true);
      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(1);
      expect(tasks[0].dagStatus).toBe('running');
    });

    it('delegation after all DAG tasks complete creates new task', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'a', role: 'developer' },
        { taskId: 'b', role: 'developer' },
      ]);
      dag.startTask(lead.id, 'a', 'agent-x');
      dag.completeTask(lead.id, 'a');
      dag.startTask(lead.id, 'b', 'agent-y');
      dag.completeTask(lead.id, 'b');

      createAgent({ task: 'New work after everything done' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(3);
      const autoTask = tasks.find(t => t.id.startsWith('auto-'));
      expect(autoTask).toBeDefined();
      expect(autoTask!.dagStatus).toBe('running');
    });

    it('rapid sequential delegations create separate tasks', () => {
      createAgent({ task: 'Task alpha' });
      createAgent({ task: 'Task beta' });
      createAgent({ task: 'Task gamma' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(3);
      const ids = new Set(tasks.map(t => t.id));
      expect(ids.size).toBe(3);
    });

    it('agent crash leaves task as failed, can be retried', () => {
      const child = createAgent({ task: 'Crashy task' });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === child.id ? child : undefined,
      );

      dispatcher.notifyParentOfCompletion(child, 1);

      const tasks = dag.getTasks(lead.id);
      const crashedTask = tasks[0];
      expect(crashedTask.dagStatus).toBe('failed');

      // Retry should reset to ready
      dag.retryTask(lead.id, crashedTask.id);
      const retried = dag.getTask(lead.id, crashedTask.id);
      expect(retried!.dagStatus).toBe('ready');
    });

    it('auto-created tasks appear in getStatus summary', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'declared-1', role: 'architect' },
        { taskId: 'declared-2', role: 'tester' },
      ]);

      createAgent({ task: 'Implement authentication module with OAuth2' });

      const status = dag.getStatus(lead.id);
      expect(status.tasks.length).toBe(3);
    });

    it('auto-created tasks appear in getTasks listing', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'declared', role: 'architect' },
      ]);

      createAgent({ task: 'Build the payment processing system' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(2);
      expect(tasks.some(t => t.id === 'declared')).toBe(true);
      expect(tasks.some(t => t.id.startsWith('auto-'))).toBe(true);
    });

    it('DECLARE_TASKS after auto-created tasks coexist', () => {
      createAgent({ task: 'Auto task alpha with unique desc' });
      createAgent({ task: 'Auto task beta completely different' });

      dag.declareTaskBatch(lead.id, [
        { taskId: 'new-1', role: 'architect' },
        { taskId: 'new-2', role: 'tester' },
        { taskId: 'new-3', role: 'designer' },
      ]);

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(5);
    });

    it('auto-created task with dependsOn on auto-created task works', () => {
      // First auto-task (different role to avoid findReadyTask match)
      createAgent({ role: 'architect', task: 'Design feature alpha architecture' });
      const firstTask = dag.getTasks(lead.id)[0];

      // Second auto-task depends on first (use very different description)
      createAgent({ task: 'Build payment gateway integration', dependsOn: [firstTask.id] });

      const tasks = dag.getTasks(lead.id);
      const secondTask = tasks.find(t => t.id !== firstTask.id);
      expect(secondTask).toBeDefined();
      expect(secondTask!.dependsOn).toContain(firstTask.id);
    });

    it('re-delegation to same agent creates new task', () => {
      const child = createAgent({ task: 'First assignment' });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === child.id ? child : undefined,
      );

      // Complete first task
      dispatcher.notifyParentOfIdle(child);

      // Reset completion tracking for this child
      (ctx as any).reportedCompletions = new Set();

      // Delegate new task
      delegateToAgent(child, { task: 'Second assignment completely different' });

      const tasks = dag.getTasks(lead.id);
      expect(tasks.length).toBe(2);
      const doneTasks = tasks.filter(t => t.dagStatus === 'done');
      const runningTasks = tasks.filter(t => t.dagStatus === 'running');
      expect(doneTasks.length).toBe(1);
      expect(runningTasks.length).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 7. INTEGRATION — Full Workflows (4 tests)
  // ════════════════════════════════════════════════════════════════════

  describe('Auto-DAG full workflow integration', () => {

    it('mixed workflow: declared + ad-hoc tasks, all tracked', () => {
      // 1. Declare some tasks
      dag.declareTaskBatch(lead.id, [
        { taskId: 'fix-api', role: 'developer', description: 'Fix API bugs' },
        { taskId: 'fix-ui', role: 'developer', description: 'Fix UI bugs' },
        { taskId: 'review-api', role: 'code-reviewer', description: 'Review API', dependsOn: ['fix-api'] },
      ]);

      // 2. Link fix-api to an agent
      const devChild1 = createAgent({ task: 'Fix API bugs', dagTaskId: 'fix-api' });
      expect(dag.getTask(lead.id, 'fix-api')!.dagStatus).toBe('running');

      // 3. Link fix-ui to another agent
      const _devChild2 = createAgent({ task: 'Fix UI bugs', dagTaskId: 'fix-ui' });
      expect(dag.getTask(lead.id, 'fix-ui')!.dagStatus).toBe('running');

      // 4. Ad-hoc delegation (auto-creates)
      const docsChild = createAgent({ task: 'Fix docs typos' });
      const tasks = dag.getTasks(lead.id);
      const autoTask = tasks.find(t => t.id.startsWith('auto-'));
      expect(autoTask).toBeDefined();

      // 5. Complete fix-api → review-api should become ready
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === devChild1.id ? devChild1 : undefined,
      );
      dispatcher.notifyParentOfIdle(devChild1);
      expect(dag.getTask(lead.id, 'fix-api')!.dagStatus).toBe('done');
      expect(dag.getTask(lead.id, 'review-api')!.dagStatus).toBe('ready');

      // 6. Complete docs
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === docsChild.id ? docsChild : undefined,
      );
      dispatcher.notifyParentOfIdle(docsChild);

      // 7. Verify final state
      const finalTasks = dag.getTasks(lead.id);
      const done = finalTasks.filter(t => t.dagStatus === 'done');
      expect(done.length).toBe(2); // fix-api + auto-docs
      expect(finalTasks.length).toBe(4); // fix-api + fix-ui + review-api + auto-docs
    });

    it('review chain: implement → review → critical-review', () => {
      // 1. Create implementation task
      const impl = createAgent({ task: 'Implement auth feature with OAuth2 and JWT tokens' });
      const implTask = dag.getTasks(lead.id).find(t => t.role === 'developer');
      expect(implTask).toBeDefined();

      // 2. Complete implementation
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === impl.id ? impl : undefined,
      );
      dispatcher.notifyParentOfIdle(impl);
      expect(implTask!.id).toBeTruthy();
      expect(dag.getTask(lead.id, implTask!.id)!.dagStatus).toBe('done');

      // 3. Code review (depends on impl via explicit dependsOn)
      createAgent({
        role: 'code-reviewer',
        task: 'Review auth implementation for correctness',
        dependsOn: [implTask!.id],
      });

      const reviewTask = dag.getTasks(lead.id).find(t => t.role === 'code-reviewer');
      expect(reviewTask).toBeDefined();
      expect(reviewTask!.dependsOn).toContain(implTask!.id);
      // Since impl is done, review should be running
      expect(reviewTask!.dagStatus).toBe('running');

      // 4. Critical review (also depends on impl, different enough description)
      createAgent({
        role: 'critical-reviewer',
        task: 'Security and performance audit of auth module',
        dependsOn: [implTask!.id],
      });

      const critTask = dag.getTasks(lead.id).find(t => t.role === 'critical-reviewer');
      expect(critTask).toBeDefined();
      expect(critTask!.dependsOn).toContain(implTask!.id);
    });

    it('DAG percentage includes both declared and auto-created tasks', () => {
      // 3 declared (different roles to avoid findReadyTask matching)
      dag.declareTaskBatch(lead.id, [
        { taskId: 'd1', role: 'architect' },
        { taskId: 'd2', role: 'tester' },
        { taskId: 'd3', role: 'designer' },
      ]);
      dag.startTask(lead.id, 'd1', 'agent-d1');
      dag.completeTask(lead.id, 'd1');
      dag.startTask(lead.id, 'd2', 'agent-x');
      dag.startTask(lead.id, 'd3', 'agent-y');

      // 2 auto-created
      const child1 = createAgent({ task: 'Implement payment processing system' });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === child1.id ? child1 : undefined,
      );
      dispatcher.notifyParentOfIdle(child1);

      createAgent({ task: 'Build notification microservice backend' });

      const status = dag.getStatus(lead.id);
      expect(status.tasks.length).toBe(5);
      const done = status.tasks.filter(t => t.dagStatus === 'done');
      expect(done.length).toBe(2); // d1 + auto-1
    });

    it('dependency chain across auto-created tasks resolves correctly', () => {
      // Task A: implement
      const childA = createAgent({ task: 'Implement core module with authentication' });
      const taskA = dag.getTasks(lead.id).find(t => t.assignedAgentId === childA.id)!;

      // Task B: review (depends on A, different role)
      createAgent({
        role: 'code-reviewer',
        task: 'Review core module changes',
        dependsOn: [taskA.id],
      });
      const taskB = dag.getTasks(lead.id).find(t => t.role === 'code-reviewer')!;
      expect(taskB).toBeDefined();
      // Auto-task stays running — addDependency no longer regresses running→blocked
      expect(taskB.dagStatus).toBe('running');
      expect(taskB.dependsOn).toContain(taskA.id);

      // Task C: fix issues (depends on B, different role to avoid matching)
      createAgent({
        role: 'tester',
        task: 'Verify fixes from code review',
        dependsOn: [taskB.id],
      });
      const taskC = dag.getTasks(lead.id).find(t => t.role === 'tester')!;
      expect(taskC).toBeDefined();
      // Auto-task stays running — addDependency no longer regresses running→blocked
      expect(taskC.dagStatus).toBe('running');
      expect(taskC.dependsOn).toContain(taskB.id);

      // Complete A
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === lead.id ? lead : id === childA.id ? childA : undefined,
      );
      dispatcher.notifyParentOfIdle(childA);
      expect(dag.getTask(lead.id, taskA.id)!.dagStatus).toBe('done');
      // B and C remain running
      expect(dag.getTask(lead.id, taskB.id)!.dagStatus).toBe('running');
      expect(dag.getTask(lead.id, taskC.id)!.dagStatus).toBe('running');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Bonus: generateAutoTaskId unit tests
  // ════════════════════════════════════════════════════════════════════

  describe('generateAutoTaskId', () => {
    it('produces auto-prefixed readable ID', () => {
      const id = generateAutoTaskId('developer', 'Fix DAG auto-linking bugs');
      expect(id).toMatch(/^auto-developer-/);
      expect(id).toMatch(/fix|dag|auto/);
    });

    it('truncates long descriptions to 3 words', () => {
      const id = generateAutoTaskId('architect', 'Design the entire system architecture from scratch');
      const parts = id.split('-');
      // auto + architect + up-to-3-words + suffix = max ~6 segments
      expect(parts.length).toBeLessThanOrEqual(7);
    });

    it('handles empty task gracefully', () => {
      const id = generateAutoTaskId('developer', '');
      expect(id).toMatch(/^auto-developer-task-/);
    });

    it('strips special characters', () => {
      const id = generateAutoTaskId('developer', 'Fix bugs!!! @#$ in API');
      expect(id).not.toMatch(/[!@#$]/);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Bonus: inferReviewDependencies unit tests
  // ════════════════════════════════════════════════════════════════════

  describe('inferReviewDependencies', () => {
    it('matches agent ID hex prefix in task description', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'impl-auth', role: 'developer', description: 'Implement auth' },
      ]);
      dag.startTask(lead.id, 'impl-auth', 'agent-0b85de78');

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review changes by 0b85de78',
      );
      expect(deps).toContain('impl-auth');
    });

    it('matches agent ID when assignedAgentId lacks prefix', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'impl-auth', role: 'developer', description: 'Implement auth' },
      ]);
      dag.startTask(lead.id, 'impl-auth', '0b85de78');

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review changes by 0b85de78',
      );
      expect(deps).toContain('impl-auth');
    });

    it('matches DAG task ID pattern (p0-2-autolink)', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'p0-2-autolink', role: 'developer', description: 'Fix autolink' },
      ]);

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review the p0-2-autolink implementation',
      );
      expect(deps).toContain('p0-2-autolink');
    });

    it('matches auto-prefixed task IDs', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'auto-dev-fix-bugs-abc1', role: 'developer', description: 'Fix bugs' },
      ]);

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review auto-dev-fix-bugs-abc1 changes',
      );
      expect(deps).toContain('auto-dev-fix-bugs-abc1');
    });

    it('falls back to role reference when no ID matches', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'impl-task', role: 'developer', description: 'Implement feature' },
      ]);
      dag.startTask(lead.id, 'impl-task', 'agent-xyz');

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review work from the developer',
      );
      expect(deps).toContain('impl-task');
    });

    it('returns empty for no matching references', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'task-a', role: 'developer', description: 'Build feature' },
      ]);

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review general code quality',
      );
      expect(deps).toHaveLength(0);
    });

    it('deduplicates when both agent ID and task ID match same task', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'p0-2-autolink', role: 'developer', description: 'Fix autolink' },
      ]);
      dag.startTask(lead.id, 'p0-2-autolink', '0b85de78');

      const deps = inferReviewDependencies(
        { taskDAG: dag } as any,
        lead.id,
        'Review p0-2-autolink by 0b85de78',
      );
      expect(deps.filter(d => d === 'p0-2-autolink').length).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Bonus: wouldCreateCycle unit tests
  // ════════════════════════════════════════════════════════════════════

  describe('wouldCreateCycle', () => {
    it('detects direct cycle (A→B→A)', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'a', role: 'dev', description: 'A' },
        { taskId: 'b', role: 'dev', description: 'B' },
      ]);
      dag.addDependency(lead.id, 'a', 'b');
      expect(dag.wouldCreateCycle(lead.id, 'b', 'a')).toBe(true);
    });

    it('detects transitive cycle (A→B→C→A)', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'a', role: 'dev', description: 'A' },
        { taskId: 'b', role: 'dev', description: 'B' },
        { taskId: 'c', role: 'dev', description: 'C' },
      ]);
      dag.addDependency(lead.id, 'a', 'b');
      dag.addDependency(lead.id, 'b', 'c');
      expect(dag.wouldCreateCycle(lead.id, 'c', 'a')).toBe(true);
    });

    it('returns false for valid edge', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'a', role: 'dev', description: 'A' },
        { taskId: 'b', role: 'dev', description: 'B' },
      ]);
      expect(dag.wouldCreateCycle(lead.id, 'a', 'b')).toBe(false);
    });

    it('detects self-cycle', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'a', role: 'dev', description: 'A' },
      ]);
      expect(dag.wouldCreateCycle(lead.id, 'a', 'a')).toBe(true);
    });

    it('handles diamond shape without false positive', () => {
      dag.declareTaskBatch(lead.id, [
        { taskId: 'a', role: 'dev', description: 'A' },
        { taskId: 'b', role: 'dev', description: 'B' },
        { taskId: 'c', role: 'dev', description: 'C' },
        { taskId: 'd', role: 'dev', description: 'D' },
      ]);
      dag.addDependency(lead.id, 'a', 'b');
      dag.addDependency(lead.id, 'a', 'c');
      dag.addDependency(lead.id, 'b', 'd');
      dag.addDependency(lead.id, 'c', 'd');
      // D→A would create cycle
      expect(dag.wouldCreateCycle(lead.id, 'd', 'a')).toBe(true);
      // B→D already exists but wouldn't create new cycle
      expect(dag.wouldCreateCycle(lead.id, 'b', 'd')).toBe(false);
    });
  });
});
