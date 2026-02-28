import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandDispatcher, type CommandContext, type Delegation } from '../agents/CommandDispatcher.js';
import type { Agent } from '../agents/Agent.js';
import type { Role } from '../agents/RoleRegistry.js';
import { MAX_CONCURRENCY_LIMIT } from '../config.js';

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

function makeChildAgent(parentId: string, overrides: Partial<Record<string, any>> = {}): Agent {
  return makeAgent({
    id: 'agent-child-0002-0000-000000000002',
    role: makeRole(),
    status: 'idle',
    parentId,
    ...overrides,
  });
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    getAgent: vi.fn(),
    getAllAgents: vi.fn().mockReturnValue([]),
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
    } as any,
    activityLedger: {
      log: vi.fn(),
    } as any,
    messageBus: {
      send: vi.fn(),
    } as any,
    decisionLog: {
      add: vi.fn().mockReturnValue({ id: 'dec-1', status: 'recorded' }),
    } as any,
    agentMemory: {
      store: vi.fn(),
      getByLead: vi.fn().mockReturnValue([]),
    } as any,
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
      getTaskByAgent: vi.fn().mockReturnValue(null),
      completeTask: vi.fn().mockReturnValue([]),
      failTask: vi.fn(),
      startTask: vi.fn(),
      pauseTask: vi.fn(),
      retryTask: vi.fn(),
      skipTask: vi.fn(),
      resolveReady: vi.fn().mockReturnValue([]),
      addTask: vi.fn(),
      cancelTask: vi.fn(),
    } as any,
    deferredIssueRegistry: {
      add: vi.fn().mockReturnValue({ id: 'issue-1' }),
      list: vi.fn().mockReturnValue([]),
      resolve: vi.fn().mockReturnValue(true),
      dismiss: vi.fn().mockReturnValue(true),
    } as any,
    maxConcurrent: 10,
    markHumanInterrupt: vi.fn(),
    ...overrides,
  };
}

/** Feed text through appendToBuffer + scanBuffer (the real public API) */
function dispatch(dispatcher: CommandDispatcher, agent: Agent, text: string): void {
  dispatcher.appendToBuffer(agent.id, text);
  dispatcher.scanBuffer(agent);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('CommandDispatcher', () => {
  let ctx: CommandContext;
  let dispatcher: CommandDispatcher;
  let leadAgent: Agent;

  beforeEach(() => {
    ctx = makeContext();
    dispatcher = new CommandDispatcher(ctx);
    leadAgent = makeAgent();
  });

  // ── File locking ───────────────────────────────────────────────────

  describe('LOCK_FILE', () => {
    it('dispatches lock request to lockRegistry.acquire', () => {
      dispatch(dispatcher, leadAgent, '[[[ LOCK_FILE {"filePath": "src/index.ts", "reason": "editing"} ]]]');

      expect(ctx.lockRegistry.acquire).toHaveBeenCalledWith(
        leadAgent.id,
        'lead',
        'src/index.ts',
        'editing',
      );
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Lock acquired'),
      );
    });
  });

  describe('UNLOCK_FILE', () => {
    it('releases lock via lockRegistry.release', () => {
      dispatch(dispatcher, leadAgent, '[[[ UNLOCK_FILE {"filePath": "src/index.ts"} ]]]');

      expect(ctx.lockRegistry.release).toHaveBeenCalledWith(
        leadAgent.id,
        'src/index.ts',
      );
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Lock released'),
      );
    });
  });

  // ── Activity logging ───────────────────────────────────────────────

  describe('ACTIVITY', () => {
    it('logs activity to the activityLedger', () => {
      dispatch(dispatcher, leadAgent, '[[[ ACTIVITY {"actionType": "file_edit", "summary": "edited index.ts"} ]]]');

      expect(ctx.activityLedger.log).toHaveBeenCalledWith(
        leadAgent.id,
        'lead',
        'file_edit',
        'edited index.ts',
        expect.any(Object),
      );
    });
  });

  // ── Decision logging ───────────────────────────────────────────────

  describe('DECISION', () => {
    it('records decision via decisionLog.add', () => {
      dispatch(dispatcher, leadAgent, '[[[ DECISION {"title": "Use React", "rationale": "best fit"} ]]]');

      expect(ctx.decisionLog.add).toHaveBeenCalledWith(
        leadAgent.id,
        'lead',
        'Use React',
        'best fit',
        false,
        leadAgent.id, // leadId fallback to self when no parentId
        undefined, // projectId
      );
    });
  });

  // ── Progress updates ───────────────────────────────────────────────

  describe('PROGRESS', () => {
    it('emits lead:progress event', () => {
      (ctx.getAllAgents as any).mockReturnValue([leadAgent]);
      dispatch(dispatcher, leadAgent, '[[[ PROGRESS {"summary": "50% done"} ]]]');

      expect(ctx.emit).toHaveBeenCalledWith(
        'lead:progress',
        expect.objectContaining({ agentId: leadAgent.id, summary: '50% done' }),
      );
    });
  });

  // ── Query crew ─────────────────────────────────────────────────────

  describe('QUERY_CREW', () => {
    it('sends crew roster to the requesting agent', () => {
      const child = makeChildAgent(leadAgent.id);
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.getRunningCount as any).mockReturnValue(2);

      dispatch(dispatcher, leadAgent, '[[[ QUERY_CREW ]]]');

      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('CREW_ROSTER'),
      );
    });
  });

  // ── Broadcast ──────────────────────────────────────────────────────

  describe('BROADCAST', () => {
    it('sends message to all team children', () => {
      const child1 = makeChildAgent(leadAgent.id, {
        id: 'agent-child-0003-0000-000000000003',
        status: 'running',
      });
      const child2 = makeChildAgent(leadAgent.id, {
        id: 'agent-child-0004-0000-000000000004',
        status: 'idle',
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child1, child2]);

      dispatch(dispatcher, leadAgent, '[[[ BROADCAST {"content": "hello all"} ]]]');

      expect((child1.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('hello all'),
      );
      expect((child2.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('hello all'),
      );
    });
  });

  // ── CREATE_AGENT ───────────────────────────────────────────────────

  describe('CREATE_AGENT', () => {
    it('spawns a new agent when role exists', () => {
      const devRole = makeRole();
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);
      const newChild = makeChildAgent(leadAgent.id, { id: 'agent-new-child-0000-000000000005' });
      (ctx.spawnAgent as any).mockReturnValue(newChild);

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "build feature"} ]]]');

      expect(ctx.roleRegistry.get).toHaveBeenCalledWith('developer');
      expect(ctx.spawnAgent).toHaveBeenCalledWith(
        devRole,
        'build feature',
        leadAgent.id,
        true,
        undefined, // model
        leadAgent.cwd,
      );
    });

    it('rejects non-lead agents', () => {
      const devAgent = makeAgent({
        id: 'agent-dev-0006-0000-000000000006',
        role: makeRole(),
      });

      dispatch(dispatcher, devAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "build"} ]]]');

      expect(ctx.spawnAgent).not.toHaveBeenCalled();
      expect((devAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Only the Project Lead'),
      );
    });

    it('auto-scales concurrency limit and retries when limit is reached', () => {
      const devRole = makeRole();
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);
      (ctx.getRunningCount as any).mockReturnValue(10);
      (ctx.getAllAgents as any).mockReturnValue([]);
      let callCount = 0;
      const newChild = makeChildAgent(leadAgent.id, { id: 'agent-new-0099' });
      (ctx.spawnAgent as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('Concurrency limit reached');
        return newChild;
      });

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "build"} ]]]');

      // Should have auto-scaled and retried
      expect(ctx.maxConcurrent).toBe(20); // 10 + 10
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('auto-increased'),
      );
      // The retry should have succeeded
      expect(ctx.spawnAgent).toHaveBeenCalledTimes(2);
    });

    it('sends error when auto-scale retry also fails', () => {
      const devRole = makeRole();
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);
      (ctx.getRunningCount as any).mockReturnValue(10);
      (ctx.getAllAgents as any).mockReturnValue([]);
      (ctx.spawnAgent as any).mockImplementation(() => {
        throw new Error('Concurrency limit reached');
      });

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "build"} ]]]');

      // Should have auto-scaled once, then reported failure on retry
      expect(ctx.maxConcurrent).toBe(20);
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('auto-increased'),
      );
      // The retry fails with a regular error message since auto-scale was already tried
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create agent'),
      );
    });

    it('rejects auto-scaling when hard concurrency cap is reached', () => {
      const devRole = makeRole();
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);
      ctx.maxConcurrent = MAX_CONCURRENCY_LIMIT;
      (ctx.getRunningCount as any).mockReturnValue(MAX_CONCURRENCY_LIMIT);
      (ctx.getAllAgents as any).mockReturnValue([]);
      (ctx.spawnAgent as any).mockImplementation(() => {
        throw new Error('Concurrency limit reached');
      });

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "build"} ]]]');

      // Should NOT auto-scale past the hard cap
      expect(ctx.maxConcurrent).toBe(MAX_CONCURRENCY_LIMIT);
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('hard cap'),
      );
    });
  });

  // ── DELEGATE ───────────────────────────────────────────────────────

  describe('DELEGATE', () => {
    it('creates a delegation and sends task to child', () => {
      const child = makeChildAgent(leadAgent.id);
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);

      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "review code"} ]]]`);

      // Delegation was tracked
      const delegations = dispatcher.getDelegationsMap();
      expect(delegations.size).toBe(1);

      const del = Array.from(delegations.values())[0];
      expect(del.toAgentId).toBe(child.id);
      expect(del.fromAgentId).toBe(leadAgent.id);
      expect(del.task).toBe('review code');
      expect(del.status).toBe('active');

      // Task was sent to the child
      expect((child.sendMessage as any)).toHaveBeenCalledWith('review code');
    });

    it('rejects non-lead agents', () => {
      const devAgent = makeAgent({
        id: 'agent-dev-0007-0000-000000000007',
        role: makeRole(),
      });

      dispatch(dispatcher, devAgent, '[[[ DELEGATE {"to": "agent-123", "task": "review"} ]]]');

      expect(dispatcher.getDelegationsMap().size).toBe(0);
      expect((devAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Only the Project Lead'),
      );
    });

    it('warns about similar active delegations', () => {
      const child1 = makeChildAgent(leadAgent.id, { id: 'agent-child-001' });
      const child2 = makeChildAgent(leadAgent.id, { id: 'agent-child-002' });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child1, child2]);

      // First delegation
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child1.id}", "task": "fix the cascade termination bug in AgentManager"} ]]]`);
      // Second delegation with similar task
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child2.id}", "task": "fix the cascade termination issue in AgentManager"} ]]]`);

      // Second delegation should include a duplicate warning
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Similar task already delegated'),
      );
    });
  });

  // ── TERMINATE_AGENT ─────────────────────────────────────────────────────

  describe('TERMINATE_AGENT', () => {
    it('terminates the targeted child agent', () => {
      const child = makeChildAgent(leadAgent.id);
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);

      dispatch(dispatcher, leadAgent, `[[[ TERMINATE_AGENT {"id": "${child.id}", "reason": "done"} ]]]`);

      expect(ctx.terminateAgent).toHaveBeenCalledWith(child.id);
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Terminated'),
      );
    });

    it('rejects non-lead agents', () => {
      const devAgent = makeAgent({
        id: 'agent-dev-0008-0000-000000000008',
        role: makeRole(),
      });

      dispatch(dispatcher, devAgent, '[[[ TERMINATE_AGENT {"id": "agent-123", "reason": "done"} ]]]');

      expect(ctx.terminateAgent).not.toHaveBeenCalled();
      expect((devAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Only the Project Lead'),
      );
    });

    it('allows terminating a sub-lead\'s child agent (grandchild)', () => {
      const subLead = makeAgent({
        id: 'agent-sub-0003-0000-000000000003',
        role: { id: 'lead', name: 'Sub Lead', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
        parentId: leadAgent.id,
      });
      const grandchild = makeChildAgent(subLead.id, {
        id: 'agent-gc-0004-0000-000000000004',
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, subLead, grandchild]);

      dispatch(dispatcher, leadAgent, `[[[ TERMINATE_AGENT {"id": "${grandchild.id}", "reason": "cleanup"} ]]]`);

      expect(ctx.terminateAgent).toHaveBeenCalledWith(grandchild.id);
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Terminated'),
      );
    });

    it('rejects terminating an agent belonging to another top-level lead', () => {
      const otherLead = makeAgent({
        id: 'agent-other-0005-0000-000000000005',
        role: { id: 'lead', name: 'Other Lead', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
        parentId: undefined,
      });
      const otherChild = makeChildAgent(otherLead.id, {
        id: 'agent-oc-0006-0000-000000000006',
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, otherLead, otherChild]);

      dispatch(dispatcher, leadAgent, `[[[ TERMINATE_AGENT {"id": "${otherChild.id}", "reason": "steal"} ]]]`);

      expect(ctx.terminateAgent).not.toHaveBeenCalled();
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('belongs to another lead'),
      );
    });

    it('rejects terminating another top-level lead itself', () => {
      const otherLead = makeAgent({
        id: 'agent-other-0005-0000-000000000005',
        role: { id: 'lead', name: 'Other Lead', description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
        parentId: undefined,
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, otherLead]);

      dispatch(dispatcher, leadAgent, `[[[ TERMINATE_AGENT {"id": "${otherLead.id}", "reason": "remove"} ]]]`);

      expect(ctx.terminateAgent).not.toHaveBeenCalled();
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('belongs to another lead'),
      );
    });
  });

  // ── Delegation cleanup ─────────────────────────────────────────────

  describe('delegation lifecycle', () => {
    it('completeDelegationsForAgent marks active delegations as failed', () => {
      const child = makeChildAgent(leadAgent.id);
      const devRole = makeRole({ id: 'developer', name: 'Developer' });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.spawnAgent as any).mockReturnValue(child);
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);

      // Create a delegation by spawning via CREATE_AGENT
      dispatch(dispatcher, leadAgent, `[[[ CREATE_AGENT {"role": "developer", "task": "work"} ]]]`);

      const delegations = dispatcher.getDelegations(leadAgent.id);
      expect(delegations.length).toBeGreaterThan(0);
      expect(delegations[0].status).toBe('active');

      // Simulate agent terminated — complete its delegations
      dispatcher.completeDelegationsForAgent(child.id);

      const updated = dispatcher.getDelegations(leadAgent.id);
      expect(updated[0].status).toBe('failed');
    });

    it('cleanupStaleDelegations removes old completed delegations', () => {
      const child = makeChildAgent(leadAgent.id);
      const devRole = makeRole({ id: 'developer', name: 'Developer' });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.spawnAgent as any).mockReturnValue(child);
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);

      // Create a delegation
      dispatch(dispatcher, leadAgent, `[[[ CREATE_AGENT {"role": "developer", "task": "work"} ]]]`);

      // Mark it as completed
      dispatcher.completeDelegationsForAgent(child.id);

      // With maxAge=0, everything old gets cleaned
      const removed = dispatcher.cleanupStaleDelegations(0);
      expect(removed).toBe(1);
      expect(dispatcher.getDelegations().length).toBe(0);
    });
  });

  // ── Multiple commands in one text ──────────────────────────────────

  describe('multiple commands', () => {
    it('dispatches both LOCK_FILE and ACTIVITY from one text', () => {
      const text = [
        'Some preamble text.',
        '[[[ LOCK_FILE {"filePath": "src/main.ts", "reason": "editing"} ]]]',
        'Some middle text.',
        '[[[ ACTIVITY {"actionType": "file_edit", "summary": "changed main"} ]]]',
        'Trailing text.',
      ].join('\n');

      dispatch(dispatcher, leadAgent, text);

      expect(ctx.lockRegistry.acquire).toHaveBeenCalledWith(
        leadAgent.id,
        'lead',
        'src/main.ts',
        'editing',
      );
      expect(ctx.activityLedger.log).toHaveBeenCalledWith(
        leadAgent.id,
        'lead',
        'file_edit',
        'changed main',
        expect.any(Object),
      );
    });
  });

  // ── Invalid JSON ───────────────────────────────────────────────────

  describe('invalid JSON', () => {
    it('handles gracefully without crashing', () => {
      // The regex requires {...} so truly malformed JSON like {bad json} won't match
      // as a valid JSON object. But a regex-matching string with invalid JSON will
      // hit the try/catch in the handler and be silently ignored (logged).
      expect(() => {
        dispatch(dispatcher, leadAgent, '[[[ LOCK_FILE {"filePath": "missing-quote} ]]]');
      }).not.toThrow();

      // No lock should have been acquired since JSON parsing failed
      expect(ctx.lockRegistry.acquire).not.toHaveBeenCalled();
    });
  });

  // ── getDelegationsMap / delegation lifecycle ───────────────────────

  describe('delegation lifecycle', () => {
    it('getDelegationsMap returns tracked delegations', () => {
      const child = makeChildAgent(leadAgent.id);
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);

      // Create via DELEGATE command
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "task-1"} ]]]`);

      const map = dispatcher.getDelegationsMap();
      expect(map.size).toBe(1);
      const del = Array.from(map.values())[0];
      expect(del.status).toBe('active');
      expect(del.toAgentId).toBe(child.id);
    });

    it('getDelegations filters by parentId', () => {
      const child = makeChildAgent(leadAgent.id);
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);

      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "task-1"} ]]]`);

      const forLead = dispatcher.getDelegations(leadAgent.id);
      expect(forLead.length).toBe(1);

      const forOther = dispatcher.getDelegations('nonexistent-id');
      expect(forOther.length).toBe(0);
    });
  });

  // ── Buffer management ──────────────────────────────────────────────

  describe('buffer management', () => {
    it('appendToBuffer accumulates text', () => {
      dispatcher.appendToBuffer('agent-1', 'hello ');
      dispatcher.appendToBuffer('agent-1', 'world');
      // Verify by dispatching a command that spans both appends
      const agent = makeAgent({ id: 'agent-1' });
      dispatcher.appendToBuffer('agent-1', ' [[[ QUERY_CREW ]]]');
      (ctx.getAllAgents as any).mockReturnValue([agent]);
      (ctx.getRunningCount as any).mockReturnValue(1);
      dispatcher.scanBuffer(agent);

      expect((agent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('CREW_ROSTER'),
      );
    });

    it('clearBuffer removes buffered text', () => {
      dispatcher.appendToBuffer('agent-1', '[[[ QUERY_CREW ]]]');
      dispatcher.clearBuffer('agent-1');

      const agent = makeAgent({ id: 'agent-1' });
      (ctx.getAllAgents as any).mockReturnValue([agent]);
      dispatcher.scanBuffer(agent);

      // No command should have fired since buffer was cleared
      expect((agent.sendMessage as any)).not.toHaveBeenCalled();
    });
  });

  // ── CREATE_AGENT with model ────────────────────────────────────────

  describe('CREATE_AGENT with model', () => {
    it('passes model to spawnAgent', () => {
      const devRole = makeRole();
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);
      const newChild = makeChildAgent(leadAgent.id, { id: 'agent-new-0009' });
      (ctx.spawnAgent as any).mockReturnValue(newChild);

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "build", "model": "claude-opus-4"} ]]]');

      expect(ctx.spawnAgent).toHaveBeenCalledWith(
        devRole,
        'build',
        leadAgent.id,
        true,
        'claude-opus-4',
        leadAgent.cwd,
      );
      // Memory stores model
      expect(ctx.agentMemory.store).toHaveBeenCalledWith(
        leadAgent.id,
        newChild.id,
        'model',
        'claude-opus-4',
      );
    });
  });

  // ── DELEGATE with context ──────────────────────────────────────────

  describe('DELEGATE with context', () => {
    it('sends task + context to child', () => {
      const child = makeChildAgent(leadAgent.id);
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);

      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "review code", "context": "PR #42"} ]]]`);

      expect((child.sendMessage as any)).toHaveBeenCalledWith('review code\n\nContext: PR #42');

      // Memory stores context
      expect(ctx.agentMemory.store).toHaveBeenCalledWith(
        leadAgent.id,
        child.id,
        'context',
        'PR #42',
      );
    });
  });

  // ── CANCEL_DELEGATION ────────────────────────────────────────────────

  describe('CANCEL_DELEGATION', () => {
    it('cancels delegations by agentId and clears pending messages', () => {
      const clearPendingMessages = vi.fn().mockReturnValue({ count: 2, previews: ['task 1...', 'task 2...'] });
      const child = makeChildAgent(leadAgent.id, {
        clearPendingMessages,
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.getAgent as any).mockImplementation((id: string) => {
        if (id === leadAgent.id) return leadAgent;
        if (id === child.id) return child;
        return undefined;
      });

      // First create a delegation so there's something to cancel
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "review code"} ]]]`);

      // Now cancel it
      dispatch(dispatcher, leadAgent, `[[[ CANCEL_DELEGATION {"agentId": "${child.id}"} ]]]`);

      // Delegation should be cancelled
      const delegations = Array.from(dispatcher.getDelegationsMap().values());
      expect(delegations[0].status).toBe('cancelled');

      // Pending messages should be cleared
      expect(clearPendingMessages).toHaveBeenCalled();

      // Lead should get confirmation
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Cancelled 1 delegation(s)'),
      );
    });

    it('cancels delegation by delegationId', () => {
      const clearPendingMessages = vi.fn().mockReturnValue({ count: 1, previews: ['some task'] });
      const child = makeChildAgent(leadAgent.id, {
        clearPendingMessages,
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.getAgent as any).mockImplementation((id: string) => {
        if (id === leadAgent.id) return leadAgent;
        if (id === child.id) return child;
        return undefined;
      });

      // Create a delegation
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "build feature"} ]]]`);

      const delegations = Array.from(dispatcher.getDelegationsMap().values());
      const delegationId = delegations[0].id;

      // Cancel by delegation ID
      dispatch(dispatcher, leadAgent, `[[[ CANCEL_DELEGATION {"delegationId": "${delegationId}"} ]]]`);

      expect(delegations[0].status).toBe('cancelled');
      expect(clearPendingMessages).toHaveBeenCalled();
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining(`Delegation ${delegationId} cancelled`),
      );
    });

    it('rejects non-lead agents', () => {
      const devAgent = makeAgent({
        id: 'agent-dev-0010-0000-000000000010',
        role: makeRole(),
      });

      dispatch(dispatcher, devAgent, '[[[ CANCEL_DELEGATION {"agentId": "some-agent"} ]]]');

      expect((devAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Only the Project Lead'),
      );
    });

    it('reports error when agent not found', () => {
      (ctx.getAllAgents as any).mockReturnValue([leadAgent]);
      (ctx.getAgent as any).mockReturnValue(undefined);

      dispatch(dispatcher, leadAgent, '[[[ CANCEL_DELEGATION {"agentId": "nonexistent"} ]]]');

      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Agent not found'),
      );
    });

    it('reports error when delegation not found by ID', () => {
      dispatch(dispatcher, leadAgent, '[[[ CANCEL_DELEGATION {"delegationId": "del-nonexistent"} ]]]');

      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Delegation not found'),
      );
    });

    it('reports error when no agentId or delegationId provided', () => {
      dispatch(dispatcher, leadAgent, '[[[ CANCEL_DELEGATION {} ]]]');

      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('requires either "agentId" or "delegationId"'),
      );
    });

    it('cancels delegation by short agent ID prefix', () => {
      const clearPendingMessages = vi.fn().mockReturnValue({ count: 0, previews: [] });
      const child = makeChildAgent(leadAgent.id, {
        clearPendingMessages,
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.getAgent as any).mockImplementation((id: string) => {
        if (id === leadAgent.id) return leadAgent;
        if (id === child.id) return child;
        return undefined;
      });

      // Create a delegation
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "test task"} ]]]`);

      // Cancel using short ID prefix (first 8 chars)
      const shortId = child.id.slice(0, 8);
      dispatch(dispatcher, leadAgent, `[[[ CANCEL_DELEGATION {"agentId": "${shortId}"} ]]]`);

      const delegations = Array.from(dispatcher.getDelegationsMap().values());
      expect(delegations[0].status).toBe('cancelled');
    });

    it('rejects cancelling already-completed delegation', () => {
      const clearPendingMessages = vi.fn().mockReturnValue({ count: 0, previews: [] });
      const child = makeChildAgent(leadAgent.id, {
        clearPendingMessages,
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.getAgent as any).mockImplementation((id: string) => {
        if (id === leadAgent.id) return leadAgent;
        if (id === child.id) return child;
        return undefined;
      });

      // Create delegation and mark as completed
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "done task"} ]]]`);
      const delegations = Array.from(dispatcher.getDelegationsMap().values());
      delegations[0].status = 'completed';

      // Try to cancel it
      dispatch(dispatcher, leadAgent, `[[[ CANCEL_DELEGATION {"delegationId": "${delegations[0].id}"} ]]]`);

      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('already completed'),
      );
    });

    it('cleanupStaleDelegations also removes cancelled delegations', () => {
      const clearPendingMessages = vi.fn().mockReturnValue({ count: 0, previews: [] });
      const child = makeChildAgent(leadAgent.id, {
        clearPendingMessages,
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, child]);
      (ctx.getAgent as any).mockImplementation((id: string) => {
        if (id === leadAgent.id) return leadAgent;
        if (id === child.id) return child;
        return undefined;
      });

      // Create and cancel a delegation
      dispatch(dispatcher, leadAgent, `[[[ DELEGATE {"to": "${child.id}", "task": "cancelled task"} ]]]`);
      dispatch(dispatcher, leadAgent, `[[[ CANCEL_DELEGATION {"agentId": "${child.id}"} ]]]`);

      // Cleanup with maxAge=0 should remove cancelled delegations
      const removed = dispatcher.cleanupStaleDelegations(0);
      expect(removed).toBe(1);
      expect(dispatcher.getDelegations().length).toBe(0);
    });
  });

  // ── Feature: Sub-lead projectName (Issue #22.1) ──────────────────────

  describe('CREATE_AGENT sets projectName for sub-leads', () => {
    it('sets projectName from task when creating a sub-lead', () => {
      const leadRole = { id: 'lead', name: 'Project Lead', description: '', systemPrompt: '', color: '', icon: '', builtIn: true, model: 'claude-sonnet-4.5' };
      (ctx.roleRegistry.get as any).mockReturnValue(leadRole);
      const subLead = makeAgent({
        id: 'agent-sublead-0000-000000000009',
        role: leadRole,
        parentId: leadAgent.id,
        hierarchyLevel: 0,
        projectName: undefined,
      });
      (ctx.spawnAgent as any).mockReturnValue(subLead);

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "lead", "task": "Handle deployment"} ]]]');

      expect(subLead.projectName).toBe('Handle deployment');
    });

    it('sets projectName from explicit name when provided', () => {
      const leadRole = { id: 'lead', name: 'Project Lead', description: '', systemPrompt: '', color: '', icon: '', builtIn: true, model: 'claude-sonnet-4.5' };
      (ctx.roleRegistry.get as any).mockReturnValue(leadRole);
      const subLead = makeAgent({
        id: 'agent-sublead-0000-000000000010',
        role: leadRole,
        parentId: leadAgent.id,
        hierarchyLevel: 0,
        projectName: undefined,
      });
      (ctx.spawnAgent as any).mockReturnValue(subLead);

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "lead", "task": "Handle deployment", "name": "Deploy v2"} ]]]');

      expect(subLead.projectName).toBe('Deploy v2');
    });

    it('does NOT set projectName for non-lead roles', () => {
      const devRole = makeRole();
      (ctx.roleRegistry.get as any).mockReturnValue(devRole);
      const child = makeChildAgent(leadAgent.id, { id: 'agent-dev-0000-000000000011', projectName: undefined });
      (ctx.spawnAgent as any).mockReturnValue(child);

      dispatch(dispatcher, leadAgent, '[[[ CREATE_AGENT {"role": "developer", "task": "Fix bug"} ]]]');

      expect(child.projectName).toBeUndefined();
    });
  });

  // ── Feature: Group member management (Issue #22.3) ─────────────────

  describe('ADD_TO_GROUP by non-lead group member', () => {
    it('allows a group member to add new members', () => {
      const devAgent = makeAgent({
        id: 'agent-dev-member-0000-000000000012',
        role: makeRole(),
        parentId: leadAgent.id,
        status: 'running',
      });
      const newAgent = makeAgent({
        id: 'agent-new-member-0000-000000000013',
        role: makeRole({ id: 'tester', name: 'Tester' }),
        parentId: leadAgent.id,
        status: 'running',
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, devAgent, newAgent]);

      // Mock: devAgent is already a member of the group
      (ctx.chatGroupRegistry as any).findGroupForAgent = vi.fn().mockReturnValue({
        name: 'config-team',
        leadId: leadAgent.id,
        memberIds: [leadAgent.id, devAgent.id],
        createdAt: new Date().toISOString(),
      });
      (ctx.chatGroupRegistry.addMembers as any).mockReturnValue([newAgent.id]);
      (ctx.chatGroupRegistry.getMembers as any).mockReturnValue([leadAgent.id, devAgent.id, newAgent.id]);
      (ctx.chatGroupRegistry.getMessages as any).mockReturnValue([]);
      (ctx.getAgent as any).mockImplementation((id: string) => {
        if (id === devAgent.id) return devAgent;
        if (id === newAgent.id) return newAgent;
        if (id === leadAgent.id) return leadAgent;
        return undefined;
      });

      dispatch(dispatcher, devAgent, `[[[ ADD_TO_GROUP {"group": "config-team", "members": ["${newAgent.id}"]} ]]]`);

      expect(ctx.chatGroupRegistry.addMembers).toHaveBeenCalledWith(
        leadAgent.id,
        'config-team',
        [newAgent.id],
      );
      expect((devAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('Added'),
      );
    });

    it('rejects non-member non-lead trying to add to a group', () => {
      const devAgent = makeAgent({
        id: 'agent-outsider-0000-000000000014',
        role: makeRole(),
        parentId: leadAgent.id,
        status: 'running',
      });
      (ctx.getAllAgents as any).mockReturnValue([leadAgent, devAgent]);

      // Mock: devAgent is NOT a member of the group
      (ctx.chatGroupRegistry as any).findGroupForAgent = vi.fn().mockReturnValue(undefined);

      dispatch(dispatcher, devAgent, '[[[ ADD_TO_GROUP {"group": "config-team", "members": ["some-agent"]} ]]]');

      expect((devAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('must be a member'),
      );
      expect(ctx.chatGroupRegistry.addMembers).not.toHaveBeenCalled();
    });
  });

  // ── Auto-DAG-update on completion ──────────────────────────────────

  describe('auto-DAG-update on agent completion', () => {
    it('auto-completes DAG task when agent exits with code 0', () => {
      const child = makeChildAgent(leadAgent.id, {
        getRecentOutput: vi.fn().mockReturnValue('done'),
      });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === leadAgent.id ? leadAgent : id === child.id ? child : undefined,
      );
      const dagTask = { id: 'task-1', leadId: leadAgent.id, dagStatus: 'running' };
      (ctx.taskDAG.getTaskByAgent as any).mockReturnValue(dagTask);
      const readyTask = { id: 'task-2' };
      (ctx.taskDAG.completeTask as any).mockReturnValue([readyTask]);

      dispatcher.notifyParentOfCompletion(child, 0);

      expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith(leadAgent.id, 'task-1');
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('task-1'),
      );
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('task-2'),
      );
    });

    it('auto-fails DAG task when agent exits with non-zero code', () => {
      const child = makeChildAgent(leadAgent.id, {
        getRecentOutput: vi.fn().mockReturnValue('error'),
      });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === leadAgent.id ? leadAgent : id === child.id ? child : undefined,
      );
      const dagTask = { id: 'task-1', leadId: leadAgent.id, dagStatus: 'running' };
      (ctx.taskDAG.getTaskByAgent as any).mockReturnValue(dagTask);

      dispatcher.notifyParentOfCompletion(child, 1);

      expect(ctx.taskDAG.failTask).toHaveBeenCalledWith(leadAgent.id, 'task-1');
      expect((leadAgent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('FAILED'),
      );
    });

    it('skips DAG update when no matching DAG task exists', () => {
      const child = makeChildAgent(leadAgent.id, {
        getRecentOutput: vi.fn().mockReturnValue('done'),
      });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === leadAgent.id ? leadAgent : id === child.id ? child : undefined,
      );
      (ctx.taskDAG.getTaskByAgent as any).mockReturnValue(null);

      dispatcher.notifyParentOfCompletion(child, 0);

      expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
      expect(ctx.taskDAG.failTask).not.toHaveBeenCalled();
    });

    it('auto-completes DAG task via idle notification', () => {
      const child = makeChildAgent(leadAgent.id, {
        getRecentOutput: vi.fn().mockReturnValue('done'),
      });
      (ctx.getAgent as any).mockImplementation((id: string) =>
        id === leadAgent.id ? leadAgent : id === child.id ? child : undefined,
      );
      const dagTask = { id: 'task-1', leadId: leadAgent.id, dagStatus: 'running' };
      (ctx.taskDAG.getTaskByAgent as any).mockReturnValue(dagTask);
      (ctx.taskDAG.completeTask as any).mockReturnValue([]);

      dispatcher.notifyParentOfIdle(child);

      expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith(leadAgent.id, 'task-1');
    });
  });
});
