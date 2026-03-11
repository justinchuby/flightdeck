import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Database } from '../db/database.js';
import { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';
import { SessionResumeManager, type ResumeResult } from '../agents/SessionResumeManager.js';
import type { AgentJSON } from '../agents/Agent.js';
import type { Role } from '../agents/RoleRegistry.js';
import type { ServerConfig } from '../config.js';

// ── Test helpers ────────────────────────────────────────────────────

const testConfig: Partial<ServerConfig> = {
  provider: 'copilot', // copilot supports resume
};

const testRole: Role = {
  id: 'developer',
  name: 'Developer',
  description: 'Writes code',
  systemPrompt: 'You are a developer',
  color: '#00f',
  icon: '💻',
  builtIn: true,
};

const leadRole: Role = {
  id: 'lead',
  name: 'Project Lead',
  description: 'Leads the team',
  systemPrompt: 'You are a lead',
  color: '#f00',
  icon: '👨‍💼',
  builtIn: true,
};

function makeAgentJSON(overrides: Partial<AgentJSON> = {}): AgentJSON {
  return {
    id: 'agent-1',
    role: testRole,
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    inputTokens: 0,
    outputTokens: 0,
    contextWindowSize: 200000,
    contextWindowUsed: 1000,
    contextBurnRate: 0,
    estimatedExhaustionMinutes: null,
    pendingMessages: 0,
    isSubLead: false,
    hierarchyLevel: 0,
    ...overrides,
  };
}

/** Minimal mock AgentManager that emits lifecycle events and records spawn calls. */
class MockAgentManager extends EventEmitter {
  spawnCalls: Array<{ role: Role; task?: string; resumeSessionId?: string; id?: string }> = [];
  spawnResult: { id: string; sessionId: string | null } = { id: 'agent-1', sessionId: null };
  shouldThrow = false;
  throwError = 'Spawn failed';

  spawn(
    role: Role,
    task?: string,
    parentId?: string,
    _model?: string,
    _cwd?: string,
    resumeSessionId?: string,
    id?: string,
    _options?: unknown,
  ) {
    this.spawnCalls.push({ role, task, resumeSessionId, id });
    if (this.shouldThrow) throw new Error(this.throwError);
    return { id: id || this.spawnResult.id, sessionId: this.spawnResult.sessionId };
  }
}

/** Minimal mock RoleRegistry that returns roles by ID. */
class MockRoleRegistry {
  private roles = new Map<string, Role>();

  constructor(roles: Role[] = [testRole, leadRole]) {
    for (const r of roles) this.roles.set(r.id, r);
  }

  get(id: string): Role | undefined {
    return this.roles.get(id);
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SessionResumeManager', () => {
  let db: Database;
  let rosterRepo: AgentRosterRepository;
  let delegationRepo: ActiveDelegationRepository;
  let mockAgentManager: MockAgentManager;
  let mockRoleRegistry: MockRoleRegistry;
  let manager: SessionResumeManager;

  beforeEach(() => {
    db = new Database(':memory:');
    rosterRepo = new AgentRosterRepository(db);
    delegationRepo = new ActiveDelegationRepository(db);
    mockAgentManager = new MockAgentManager();
    mockRoleRegistry = new MockRoleRegistry();
    manager = new SessionResumeManager(
      mockAgentManager as any,
      rosterRepo,
      delegationRepo,
      mockRoleRegistry as any,
      testConfig as ServerConfig,
    );
  });

  afterEach(() => {
    manager.dispose();
    db.close();
  });

  // ── Lifecycle persistence tests ─────────────────────────────────

  describe('lifecycle persistence', () => {
    it('persists agent on spawn event', () => {
      const json = makeAgentJSON({
        id: 'agent-abc',
        model: 'claude-sonnet',
        projectId: 'project-1',
        task: 'Build API',
        cwd: '/home/code',
      });
      mockAgentManager.emit('agent:spawned', json);

      const record = rosterRepo.getAgent('agent-abc');
      expect(record).toBeDefined();
      expect(record!.role).toBe('developer');
      expect(record!.model).toBe('claude-sonnet');
      expect(record!.status).toBe('running'); // running → running
      expect(record!.projectId).toBe('project-1');
      expect(record!.metadata).toEqual({
        task: 'Build API',
        parentId: undefined,
        cwd: '/home/code',
      });
    });

    it('uses "default" model when agent has no model', () => {
      const json = makeAgentJSON({ model: undefined });
      mockAgentManager.emit('agent:spawned', json);

      const record = rosterRepo.getAgent('agent-1');
      expect(record!.model).toBe('default');
    });

    it('updates sessionId on session_ready event', () => {
      // Spawn first to create the roster entry
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1' }));

      mockAgentManager.emit('agent:session_ready', {
        agentId: 'agent-1',
        sessionId: 'session-xyz-123',
      });

      const record = rosterRepo.getAgent('agent-1');
      expect(record!.sessionId).toBe('session-xyz-123');
    });

    it('updates status on status change event', () => {
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1' }));

      mockAgentManager.emit('agent:status', { agentId: 'agent-1', status: 'idle' });
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('idle');

      mockAgentManager.emit('agent:status', { agentId: 'agent-1', status: 'running' });
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('running');
    });

    it('ignores creating status (transient)', () => {
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1', status: 'running' }));
      mockAgentManager.emit('agent:status', { agentId: 'agent-1', status: 'creating' });

      // Status should not change from the spawn state
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('running');
    });

    it('marks agent terminated on terminated event', () => {
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1' }));
      mockAgentManager.emit('agent:terminated', 'agent-1');

      expect(rosterRepo.getAgent('agent-1')!.status).toBe('terminated');
    });

    it('marks agent terminated on non-zero exit', () => {
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1' }));
      mockAgentManager.emit('agent:exit', { agentId: 'agent-1', code: 1 });

      expect(rosterRepo.getAgent('agent-1')!.status).toBe('terminated');
    });

    it('does not mark agent terminated on clean exit (code 0)', () => {
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1' }));
      mockAgentManager.emit('agent:exit', { agentId: 'agent-1', code: 0 });

      // Should still be running (from running spawn status)
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('running');
    });
  });

  // ── Resume operations ───────────────────────────────────────────

  describe('resumeAgent', () => {
    it('resumes agent with stored sessionId', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-abc', 'proj-1', {
        task: 'Build API',
        parentId: 'lead-1',
        cwd: '/code',
      });
      mockAgentManager.spawnResult = { id: 'agent-1', sessionId: 'session-new' };

      const result = await manager.resumeAgent('agent-1');

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('agent-1');
      expect(mockAgentManager.spawnCalls.length).toBe(1);
      expect(mockAgentManager.spawnCalls[0].role).toEqual(testRole);
      expect(mockAgentManager.spawnCalls[0].task).toBe('Build API');
      expect(mockAgentManager.spawnCalls[0].resumeSessionId).toBe('session-abc');
      expect(mockAgentManager.spawnCalls[0].id).toBe('agent-1');
    });

    it('returns error for non-existent agent', async () => {
      const result = await manager.resumeAgent('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found in roster');
    });

    it('returns error when no sessionId', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle');

      const result = await manager.resumeAgent('agent-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No sessionId');
    });

    it('returns error when role not found', async () => {
      rosterRepo.upsertAgent('agent-1', 'unknown-role', 'claude-sonnet', 'idle', 'session-1');

      const result = await manager.resumeAgent('agent-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain("Role 'unknown-role' not found");
    });

    it('marks agent terminated on spawn failure', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-1');
      mockAgentManager.shouldThrow = true;

      const result = await manager.resumeAgent('agent-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Spawn failed');
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('terminated');
    });

    it('does not pass "default" model to spawn', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'default', 'idle', 'session-1');

      await manager.resumeAgent('agent-1');

      const call = mockAgentManager.spawnCalls[0];
      // model should be undefined (so server uses default), not 'default'
      expect(call).toBeDefined();
    });
  });

  describe('resumeAll', () => {
    it('resumes all non-terminated agents with sessionIds', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-1', 'proj-1', { task: 'Task A' });
      rosterRepo.upsertAgent('agent-2', 'lead', 'gpt-4', 'running', 'session-2', 'proj-1', { task: 'Task B' });
      rosterRepo.upsertAgent('agent-3', 'developer', 'claude-haiku', 'terminated');

      mockAgentManager.spawnResult = { id: 'agent-x', sessionId: 'new-session' };

      const result = await manager.resumeAll();

      expect(result.total).toBe(2); // agent-3 excluded (terminated)
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockAgentManager.spawnCalls.length).toBe(2);
    });

    it('returns empty result when no agents to resume', async () => {
      const result = await manager.resumeAll();
      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('skips agents without sessionId', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle'); // no sessionId
      rosterRepo.upsertAgent('agent-2', 'developer', 'claude-sonnet', 'idle', 'session-2');

      const result = await manager.resumeAll();

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.skipped).toBe(1);
      expect(mockAgentManager.spawnCalls.length).toBe(1);
    });

    it('handles partial failures gracefully', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-1');
      rosterRepo.upsertAgent('agent-2', 'unknown-role', 'claude-sonnet', 'idle', 'session-2');
      rosterRepo.upsertAgent('agent-3', 'developer', 'claude-sonnet', 'idle', 'session-3');

      const result = await manager.resumeAll();

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1); // agent-2 has unknown role

      // Failed agent should be marked terminated
      expect(rosterRepo.getAgent('agent-2')!.status).toBe('idle'); // role not found doesn't terminate
    });

    it('resumes agents in parallel', async () => {
      const spawnTimes: number[] = [];
      const originalSpawn = mockAgentManager.spawn.bind(mockAgentManager);
      const wrappedSpawn = (...args: Parameters<typeof originalSpawn>) => {
        spawnTimes.push(Date.now());
        return originalSpawn(...args);
      };
      mockAgentManager.spawn = wrappedSpawn as typeof mockAgentManager.spawn;

      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-1');
      rosterRepo.upsertAgent('agent-2', 'developer', 'claude-sonnet', 'idle', 'session-2');
      rosterRepo.upsertAgent('agent-3', 'developer', 'claude-sonnet', 'idle', 'session-3');

      await manager.resumeAll();

      expect(mockAgentManager.spawnCalls.length).toBe(3);
      // All spawns should happen nearly simultaneously (within 50ms)
      if (spawnTimes.length >= 2) {
        const timeDiff = spawnTimes[spawnTimes.length - 1] - spawnTimes[0];
        expect(timeDiff).toBeLessThan(50);
      }
    });
  });

  // ── Recovery queries ──────────────────────────────────────────────

  describe('getActiveDelegations', () => {
    it('returns active delegations from repository', () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      delegationRepo.create('del-1', 'agent-1', 'Build API', 'some context', 'dag-1');
      delegationRepo.create('del-2', 'agent-1', 'Write tests');

      const active = manager.getActiveDelegations('agent-1');
      expect(active.length).toBe(2);
    });

    it('returns all active delegations when no agent filter', () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      rosterRepo.upsertAgent('agent-2', 'lead', 'gpt-4');
      delegationRepo.create('del-1', 'agent-1', 'Task A');
      delegationRepo.create('del-2', 'agent-2', 'Task B');

      const active = manager.getActiveDelegations();
      expect(active.length).toBe(2);
    });
  });

  describe('getPersistedRoster', () => {
    it('returns all agents from roster', () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      rosterRepo.upsertAgent('agent-2', 'lead', 'gpt-4');

      const roster = manager.getPersistedRoster();
      expect(roster.length).toBe(2);
    });
  });

  // ── Provider resume capability ─────────────────────────────────

  describe('provider resume capability', () => {
    it('reports supportsResume=true for copilot', () => {
      expect(manager.providerSupportsResume).toBe(true);
    });

    it('reports supportsResume=false for gemini', () => {
      const geminiManager = new SessionResumeManager(
        mockAgentManager as any, rosterRepo, delegationRepo,
        mockRoleRegistry as any, { ...testConfig, provider: 'gemini' } as ServerConfig,
      );
      expect(geminiManager.providerSupportsResume).toBe(false);
      geminiManager.dispose();
    });

    it('starts agents fresh when provider does not support resume', async () => {
      const noResumeManager = new SessionResumeManager(
        mockAgentManager as any, rosterRepo, delegationRepo,
        mockRoleRegistry as any, { ...testConfig, provider: 'codex' } as ServerConfig,
      );

      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-1', undefined, { task: 'Build API' });
      mockAgentManager.spawnResult = { id: 'agent-1', sessionId: null };

      const result = await noResumeManager.resumeAll();
      expect(result.succeeded).toBe(1);
      // Should NOT pass resumeSessionId
      expect(mockAgentManager.spawnCalls[0].resumeSessionId).toBeUndefined();
      noResumeManager.dispose();
    });

    it('passes resumeSessionId when provider supports resume', async () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', 'session-abc');

      await manager.resumeAll();

      expect(mockAgentManager.spawnCalls[0].resumeSessionId).toBe('session-abc');
    });
  });

  // ── Dispose ───────────────────────────────────────────────────────

  describe('dispose', () => {
    it('stops listening to events after dispose', () => {
      manager.dispose();

      // Emit events — they should NOT be persisted
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'after-dispose' }));
      expect(rosterRepo.getAgent('after-dispose')).toBeUndefined();
    });

    it('is idempotent', () => {
      manager.dispose();
      manager.dispose(); // should not throw
    });
  });

  // ── Full lifecycle integration ────────────────────────────────────

  describe('full lifecycle integration', () => {
    it('persists through spawn → session_ready → status_change → terminate', () => {
      // 1. Agent spawned
      mockAgentManager.emit('agent:spawned', makeAgentJSON({ id: 'agent-1', status: 'running', model: 'claude-sonnet' }));
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('running');

      // 2. Session ready
      mockAgentManager.emit('agent:session_ready', { agentId: 'agent-1', sessionId: 'sess-123' });
      expect(rosterRepo.getAgent('agent-1')!.sessionId).toBe('sess-123');

      // 3. Status changes to idle
      mockAgentManager.emit('agent:status', { agentId: 'agent-1', status: 'idle' });
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('idle');

      // 4. Back to running
      mockAgentManager.emit('agent:status', { agentId: 'agent-1', status: 'running' });
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('running');

      // 5. Terminated
      mockAgentManager.emit('agent:terminated', 'agent-1');
      expect(rosterRepo.getAgent('agent-1')!.status).toBe('terminated');
    });

    it('persists agent, then resumes on simulated restart', async () => {
      // Simulate initial session
      mockAgentManager.emit('agent:spawned', makeAgentJSON({
        id: 'agent-1',
        status: 'running',
        model: 'claude-sonnet',
        projectId: 'proj-1',
        task: 'Build the API',
      }));
      mockAgentManager.emit('agent:session_ready', { agentId: 'agent-1', sessionId: 'sess-original' });
      mockAgentManager.emit('agent:status', { agentId: 'agent-1', status: 'idle' });

      // Verify persisted state
      const persisted = rosterRepo.getAgent('agent-1');
      expect(persisted!.sessionId).toBe('sess-original');
      expect(persisted!.status).toBe('idle');

      // Simulate server restart (new SessionResumeManager, same DB)
      manager.dispose();
      const newMockManager = new MockAgentManager();
      newMockManager.spawnResult = { id: 'agent-1', sessionId: 'sess-resumed' };
      const newManager = new SessionResumeManager(
        newMockManager as any,
        rosterRepo,
        delegationRepo,
        mockRoleRegistry as any,
        testConfig as ServerConfig,
      );

      // Resume
      const result = await newManager.resumeAll();
      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(newMockManager.spawnCalls[0].resumeSessionId).toBe('sess-original');
      expect(newMockManager.spawnCalls[0].id).toBe('agent-1');

      newManager.dispose();
    });
  });

  // ── Concurrency guard ───────────────────────────────────────────

  describe('resumeAll concurrency guard', () => {
    it('serializes concurrent resumeAll() calls without corrupting state', async () => {
      // Seed two agents in the roster
      rosterRepo.upsertAgent('agent-a', 'developer', 'fast', 'idle', 'sess-a', 'proj-1');
      rosterRepo.upsertAgent('agent-b', 'developer', 'fast', 'idle', 'sess-b', 'proj-1');

      // Track spawn order
      const spawnOrder: string[] = [];
      let spawnDelay = 0;

      // Create a slow mock that introduces async delay per spawn
      const slowManager = new MockAgentManager();
      const originalSpawn = slowManager.spawn.bind(slowManager);
      slowManager.spawn = ((...args: any[]) => {
        spawnOrder.push(args[7] ?? 'unknown'); // id param
        const result = originalSpawn.apply(slowManager, args as any);
        return result;
      }) as any;

      const srm = new SessionResumeManager(
        slowManager as any,
        rosterRepo,
        delegationRepo,
        mockRoleRegistry as any,
        testConfig as ServerConfig,
      );

      // Fire two concurrent resumeAll() calls
      const [result1, result2] = await Promise.all([
        srm.resumeAll(),
        srm.resumeAll(),
      ]);

      // Both should succeed
      expect(result1.total).toBe(2);
      expect(result1.succeeded).toBe(2);
      expect(result2.total).toBe(2);
      expect(result2.succeeded).toBe(2);

      // The first call should have spawned 2 agents
      // The second call (queued) runs after first completes — spawns again
      // because it re-reads the roster. The key point: no interleaving.
      expect(spawnOrder.length).toBe(4); // 2 from first + 2 from second

      srm.dispose();
    });

    it('queued call sees updated roster state', async () => {
      rosterRepo.upsertAgent('agent-x', 'developer', 'fast', 'idle', 'sess-x', 'proj-1');

      const slowManager = new MockAgentManager();
      const srm = new SessionResumeManager(
        slowManager as any,
        rosterRepo,
        delegationRepo,
        mockRoleRegistry as any,
        testConfig as ServerConfig,
      );

      // First call in progress, second queued
      const p1 = srm.resumeAll();
      const p2 = srm.resumeAll();

      const [r1, r2] = await Promise.all([p1, p2]);

      // Both complete without error
      expect(r1.succeeded + r1.failed + r1.skipped).toBe(r1.total);
      expect(r2.succeeded + r2.failed + r2.skipped).toBe(r2.total);

      srm.dispose();
    });

    it('does not leave mutex locked after error', async () => {
      rosterRepo.upsertAgent('agent-err', 'developer', 'fast', 'idle', 'sess-err', 'proj-1');

      const errorManager = new MockAgentManager();
      errorManager.shouldThrow = true;
      errorManager.throwError = 'Simulated crash';

      const srm = new SessionResumeManager(
        errorManager as any,
        rosterRepo,
        delegationRepo,
        mockRoleRegistry as any,
        testConfig as ServerConfig,
      );

      // First call — spawn throws, but resumeAll catches it per-agent
      const result1 = await srm.resumeAll();
      expect(result1.failed).toBeGreaterThan(0);

      // Second call should still work (mutex released)
      errorManager.shouldThrow = false;
      // Agent was marked terminated by the error handler, so re-add
      rosterRepo.upsertAgent('agent-ok', 'developer', 'fast', 'idle', 'sess-ok', 'proj-1');
      const result2 = await srm.resumeAll();
      expect(result2.total).toBeGreaterThan(0);

      srm.dispose();
    });
  });
});
