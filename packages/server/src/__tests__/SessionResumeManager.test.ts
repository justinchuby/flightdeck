import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Database } from '../db/database.js';
import { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';
import { SessionResumeManager, ResumeError } from '../agents/SessionResumeManager.js';
import type { AgentJSON } from '../agents/Agent.js';
import type { Role } from '../agents/RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { ProjectSession } from '@flightdeck/shared';

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
    phase: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    model: 'claude-opus-4.6',
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

  // ── resumeLeadSession ──────────────────────────────────────────

  describe('resumeLeadSession', () => {
    const mockProjectRegistry = {
      claimSessionForResume: vi.fn().mockReturnValue(true),
      reactivateSession: vi.fn(),
    };

    function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
      return {
        id: 1,
        projectId: 'proj-1',
        leadId: 'agent-1',
        sessionId: 'copilot-session-abc',
        task: 'Build the API',
        status: 'stopped',
        role: 'lead',
        startedAt: new Date().toISOString(),
        ...overrides,
      } as ProjectSession;
    }

    const project = { id: 'proj-1', name: 'Test Project', cwd: '/code' };

    beforeEach(() => {
      vi.clearAllMocks();
      mockProjectRegistry.claimSessionForResume.mockReturnValue(true);
    });

    it('resumes a session and returns agent + task', () => {
      mockAgentManager.spawnResult = { id: 'agent-1', sessionId: 'copilot-session-abc' };

      const result = manager.resumeLeadSession(
        { session: makeSession(), project },
        mockProjectRegistry as any,
      );

      expect(result.agent).toBeDefined();
      expect(result.task).toBe('Build the API');
      expect(mockAgentManager.spawnCalls.length).toBe(1);
      expect(mockAgentManager.spawnCalls[0].resumeSessionId).toBe('copilot-session-abc');
      expect(mockAgentManager.spawnCalls[0].id).toBe('agent-1');
      expect(mockProjectRegistry.reactivateSession).toHaveBeenCalledWith(1, 'Build the API', 'lead');
    });

    it('throws ResumeError when session has no sessionId', () => {
      expect(() =>
        manager.resumeLeadSession(
          { session: makeSession({ sessionId: undefined }), project },
          mockProjectRegistry as any,
        ),
      ).toThrow(ResumeError);

      try {
        manager.resumeLeadSession(
          { session: makeSession({ sessionId: undefined }), project },
          mockProjectRegistry as any,
        );
      } catch (err) {
        expect((err as ResumeError).statusCode).toBe(400);
      }
    });

    it('throws ResumeError when session already claimed', () => {
      mockProjectRegistry.claimSessionForResume.mockReturnValue(false);

      expect(() =>
        manager.resumeLeadSession(
          { session: makeSession(), project },
          mockProjectRegistry as any,
        ),
      ).toThrow(ResumeError);

      try {
        mockProjectRegistry.claimSessionForResume.mockReturnValue(false);
        manager.resumeLeadSession(
          { session: makeSession(), project },
          mockProjectRegistry as any,
        );
      } catch (err) {
        expect((err as ResumeError).statusCode).toBe(409);
      }
    });

    it('throws ResumeError when role not found', () => {
      expect(() =>
        manager.resumeLeadSession(
          { session: makeSession({ role: 'nonexistent-role' }), project },
          mockProjectRegistry as any,
        ),
      ).toThrow(ResumeError);
    });

    it('uses task override when provided', () => {
      mockAgentManager.spawnResult = { id: 'agent-1', sessionId: 'sess' };

      const result = manager.resumeLeadSession(
        { session: makeSession(), project, task: 'Override task' },
        mockProjectRegistry as any,
      );

      expect(result.task).toBe('Override task');
    });

    it('falls back to lead role when session has no role', () => {
      mockAgentManager.spawnResult = { id: 'agent-1', sessionId: 'sess' };

      const result = manager.resumeLeadSession(
        { session: makeSession({ role: undefined }), project },
        mockProjectRegistry as any,
      );

      expect(result.agent).toBeDefined();
      expect(mockAgentManager.spawnCalls[0].role.id).toBe('lead');
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
  });
});
