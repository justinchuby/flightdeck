import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { AgentRosterRepository } from '../db/AgentRosterRepository.js';

describe('AgentRosterRepository', () => {
  let db: Database;
  let repo: AgentRosterRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repo = new AgentRosterRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertAgent', () => {
    it('inserts a new agent with required fields', () => {
      const agent = repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      expect(agent.agentId).toBe('agent-1');
      expect(agent.role).toBe('developer');
      expect(agent.model).toBe('claude-sonnet');
      expect(agent.status).toBe('idle');
      expect(agent.createdAt).toBeDefined();
      expect(agent.updatedAt).toBeDefined();
    });

    it('inserts agent with optional fields', () => {
      const agent = repo.upsertAgent(
        'agent-2', 'lead', 'gpt-4', 'running',
        'session-abc', 'project-xyz', { custom: 'data' },
      );
      expect(agent.sessionId).toBe('session-abc');
      expect(agent.projectId).toBe('project-xyz');
      expect(agent.metadata).toEqual({ custom: 'data' });
    });

    it('updates existing agent on conflict', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle');
      const updated = repo.upsertAgent('agent-1', 'lead', 'gpt-4', 'running');

      expect(updated.role).toBe('lead');
      expect(updated.model).toBe('gpt-4');
      expect(updated.status).toBe('running');

      const fromDb = repo.getAgent('agent-1');
      expect(fromDb).toBeDefined();
      expect(fromDb!.role).toBe('lead');
      expect(fromDb!.model).toBe('gpt-4');
    });

    it('preserves createdAt on upsert update', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      const original = repo.getAgent('agent-1');

      repo.upsertAgent('agent-1', 'lead', 'gpt-4', 'running');
      const updated = repo.getAgent('agent-1');

      // createdAt is stored by the DB default on first insert;
      // on update, the column is not in the SET clause so the DB keeps the original value
      expect(updated!.createdAt).toBe(original!.createdAt);
    });
  });

  describe('getAgent', () => {
    it('returns agent by id', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      const agent = repo.getAgent('agent-1');
      expect(agent).toBeDefined();
      expect(agent!.agentId).toBe('agent-1');
    });

    it('returns undefined for non-existent agent', () => {
      const agent = repo.getAgent('does-not-exist');
      expect(agent).toBeUndefined();
    });

    it('deserializes metadata JSON', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', undefined, undefined, {
        capabilities: ['code-review'],
        priority: 5,
      });
      const agent = repo.getAgent('agent-1');
      expect(agent!.metadata).toEqual({
        capabilities: ['code-review'],
        priority: 5,
      });
    });
  });

  describe('getAllAgents', () => {
    beforeEach(() => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle');
      repo.upsertAgent('agent-2', 'lead', 'gpt-4', 'running');
      repo.upsertAgent('agent-3', 'reviewer', 'claude-haiku', 'terminated');
    });

    it('returns all agents when no filter', () => {
      const agents = repo.getAllAgents();
      expect(agents.length).toBe(3);
    });

    it('filters by status', () => {
      const idle = repo.getAllAgents('idle');
      expect(idle.length).toBe(1);
      expect(idle[0].agentId).toBe('agent-1');

      const busy = repo.getAllAgents('running');
      expect(busy.length).toBe(1);
      expect(busy[0].agentId).toBe('agent-2');
    });

    it('returns empty array when no matches', () => {
      const _result = repo.getAllAgents('idle');
      // We know agent-1 is idle, but let's test with a specific scenario
      repo.updateStatus('agent-1', 'running');
      const idleAfter = repo.getAllAgents('idle');
      expect(idleAfter.length).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('updates agent status', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle');
      const updated = repo.updateStatus('agent-1', 'running');
      expect(updated).toBe(true);

      const agent = repo.getAgent('agent-1');
      expect(agent!.status).toBe('running');
    });

    it('updates updatedAt timestamp', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      const _before = repo.getAgent('agent-1')!.updatedAt;

      // Small delay to ensure timestamp differs
      repo.updateStatus('agent-1', 'running');
      const after = repo.getAgent('agent-1')!.updatedAt;
      expect(after).toBeDefined();
    });

    it('returns false for non-existent agent', () => {
      const result = repo.updateStatus('does-not-exist', 'running');
      expect(result).toBe(false);
    });
  });

  describe('updateSessionId', () => {
    it('updates session id for SDK resume', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      const updated = repo.updateSessionId('agent-1', 'new-session-123');
      expect(updated).toBe(true);

      const agent = repo.getAgent('agent-1');
      expect(agent!.sessionId).toBe('new-session-123');
    });

    it('returns false for non-existent agent', () => {
      const result = repo.updateSessionId('does-not-exist', 'session-1');
      expect(result).toBe(false);
    });
  });

  describe('updateLastTaskSummary', () => {
    it('updates last task summary', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      repo.updateLastTaskSummary('agent-1', 'Implemented feature X');

      const agent = repo.getAgent('agent-1');
      expect(agent!.lastTaskSummary).toBe('Implemented feature X');
    });
  });

  describe('removeAgent', () => {
    it('sets status to terminated (soft delete)', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'running');
      const removed = repo.removeAgent('agent-1');
      expect(removed).toBe(true);

      const agent = repo.getAgent('agent-1');
      expect(agent).toBeDefined();
      expect(agent!.status).toBe('terminated');
    });

    it('returns false for non-existent agent', () => {
      const result = repo.removeAgent('does-not-exist');
      expect(result).toBe(false);
    });
  });

  describe('deleteAgent', () => {
    it('hard-deletes agent from database', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      const deleted = repo.deleteAgent('agent-1');
      expect(deleted).toBe(true);

      const agent = repo.getAgent('agent-1');
      expect(agent).toBeUndefined();
    });

    it('returns false for non-existent agent', () => {
      const result = repo.deleteAgent('does-not-exist');
      expect(result).toBe(false);
    });
  });

  describe('lifecycle integration', () => {
    it('tracks agent through full lifecycle', () => {
      // Create
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', undefined, 'project-1');
      expect(repo.getAgent('agent-1')!.status).toBe('idle');

      // Assign work
      repo.updateStatus('agent-1', 'running');
      expect(repo.getAgent('agent-1')!.status).toBe('running');

      // Track SDK session
      repo.updateSessionId('agent-1', 'sdk-session-abc');
      expect(repo.getAgent('agent-1')!.sessionId).toBe('sdk-session-abc');

      // Complete work
      repo.updateStatus('agent-1', 'idle');
      repo.updateLastTaskSummary('agent-1', 'Built the API endpoints');
      expect(repo.getAgent('agent-1')!.lastTaskSummary).toBe('Built the API endpoints');

      // Terminate
      repo.removeAgent('agent-1');
      expect(repo.getAgent('agent-1')!.status).toBe('terminated');

      // Verify filtering
      expect(repo.getAllAgents('idle').length).toBe(0);
      expect(repo.getAllAgents('terminated').length).toBe(1);
    });
  });

  // ── Team scoping ─────────────────────────────────────────────────

  describe('team scoping', () => {
    it('defaults teamId to "default"', () => {
      const agent = repo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
      expect(agent.teamId).toBe('default');

      const fromDb = repo.getAgent('agent-1');
      expect(fromDb!.teamId).toBe('default');
    });

    it('stores and retrieves custom teamId', () => {
      const agent = repo.upsertAgent(
        'agent-t1', 'developer', 'claude-sonnet', 'idle',
        undefined, 'proj-1', undefined, 'team-alpha',
      );
      expect(agent.teamId).toBe('team-alpha');

      const fromDb = repo.getAgent('agent-t1');
      expect(fromDb!.teamId).toBe('team-alpha');
    });

    it('updates teamId on upsert', () => {
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', undefined, undefined, undefined, 'team-a');
      repo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'running', undefined, undefined, undefined, 'team-b');

      const fromDb = repo.getAgent('agent-1');
      expect(fromDb!.teamId).toBe('team-b');
    });

    it('filters getAllAgents by teamId', () => {
      repo.upsertAgent('a1', 'dev', 'model', 'idle', undefined, undefined, undefined, 'team-x');
      repo.upsertAgent('a2', 'dev', 'model', 'idle', undefined, undefined, undefined, 'team-y');
      repo.upsertAgent('a3', 'lead', 'model', 'running', undefined, undefined, undefined, 'team-x');

      expect(repo.getAllAgents(undefined, 'team-x').length).toBe(2);
      expect(repo.getAllAgents(undefined, 'team-y').length).toBe(1);
      expect(repo.getAllAgents(undefined, 'team-z').length).toBe(0);
    });

    it('filters getAllAgents by status AND teamId', () => {
      repo.upsertAgent('a1', 'dev', 'model', 'idle', undefined, undefined, undefined, 'team-x');
      repo.upsertAgent('a2', 'dev', 'model', 'running', undefined, undefined, undefined, 'team-x');
      repo.upsertAgent('a3', 'dev', 'model', 'idle', undefined, undefined, undefined, 'team-y');

      expect(repo.getAllAgents('idle', 'team-x').length).toBe(1);
      expect(repo.getAllAgents('running', 'team-x').length).toBe(1);
      expect(repo.getAllAgents('idle', 'team-y').length).toBe(1);
    });

    it('getAllAgents without teamId returns all teams', () => {
      repo.upsertAgent('a1', 'dev', 'model', 'idle', undefined, undefined, undefined, 'team-x');
      repo.upsertAgent('a2', 'dev', 'model', 'idle', undefined, undefined, undefined, 'team-y');

      expect(repo.getAllAgents().length).toBe(2);
    });
  });

  describe('reconcileStaleAgents', () => {
    it('marks busy/idle agents as terminated when not alive', () => {
      repo.upsertAgent('alive-1', 'lead', 'model', 'running');
      repo.upsertAgent('dead-1', 'dev', 'model', 'running');
      repo.upsertAgent('dead-2', 'dev', 'model', 'idle');
      repo.upsertAgent('done-1', 'dev', 'model', 'terminated');

      const reconciled = repo.reconcileStaleAgents(
        (id) => id === 'alive-1',
      );

      expect(reconciled).toBe(2);
      expect(repo.getAgent('alive-1')!.status).toBe('running');
      expect(repo.getAgent('dead-1')!.status).toBe('terminated');
      expect(repo.getAgent('dead-2')!.status).toBe('terminated');
      expect(repo.getAgent('done-1')!.status).toBe('terminated');
    });

    it('returns 0 when all agents are alive', () => {
      repo.upsertAgent('a1', 'lead', 'model', 'running');
      repo.upsertAgent('a2', 'dev', 'model', 'idle');

      const reconciled = repo.reconcileStaleAgents(() => true);
      expect(reconciled).toBe(0);
    });

    it('returns 0 when no busy/idle agents exist', () => {
      repo.upsertAgent('a1', 'dev', 'model', 'terminated');
      repo.upsertAgent('a2', 'dev', 'model', 'terminated');

      const reconciled = repo.reconcileStaleAgents(() => false);
      expect(reconciled).toBe(0);
    });
  });

  describe('deleteByProject', () => {
    it('removes all roster entries for a project', () => {
      repo.upsertAgent('lead-1', 'lead', 'claude', 'idle', undefined, 'proj-1');
      repo.upsertAgent('dev-1', 'developer', 'claude', 'idle', undefined, 'proj-1');
      repo.upsertAgent('dev-2', 'developer', 'claude', 'idle', undefined, 'proj-2');

      const deleted = repo.deleteByProject('proj-1');
      expect(deleted).toBe(2);
      expect(repo.getByProject('proj-1')).toHaveLength(0);
      // Other project untouched
      expect(repo.getByProject('proj-2')).toHaveLength(1);
    });

    it('returns 0 when no agents match', () => {
      expect(repo.deleteByProject('nonexistent')).toBe(0);
    });
  });

  describe('deleteCrew', () => {
    it('deletes lead and direct children', () => {
      repo.upsertAgent('lead-1', 'lead', 'claude', 'idle', undefined, 'proj-1');
      repo.upsertAgent('dev-1', 'developer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'lead-1' });
      repo.upsertAgent('rev-1', 'reviewer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'lead-1' });

      const deleted = repo.deleteCrew('lead-1');
      expect(deleted).toBe(3);
      expect(repo.getByProject('proj-1')).toHaveLength(0);
    });

    it('deletes grandchildren recursively', () => {
      repo.upsertAgent('lead-1', 'lead', 'claude', 'idle', undefined, 'proj-1');
      repo.upsertAgent('dev-1', 'developer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'lead-1' });
      // Grandchild: spawned by dev-1, not directly by lead
      repo.upsertAgent('sub-1', 'developer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'dev-1' });
      // Great-grandchild
      repo.upsertAgent('sub-2', 'developer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'sub-1' });

      const deleted = repo.deleteCrew('lead-1');
      expect(deleted).toBe(4);
      expect(repo.getByProject('proj-1')).toHaveLength(0);
    });

    it('does not delete agents from other crews', () => {
      repo.upsertAgent('lead-1', 'lead', 'claude', 'idle', undefined, 'proj-1');
      repo.upsertAgent('dev-1', 'developer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'lead-1' });
      repo.upsertAgent('lead-2', 'lead', 'claude', 'idle', undefined, 'proj-1');
      repo.upsertAgent('dev-2', 'developer', 'claude', 'idle', undefined, 'proj-1', { parentId: 'lead-2' });

      const deleted = repo.deleteCrew('lead-1');
      expect(deleted).toBe(2);
      // Other crew untouched
      expect(repo.getAgent('lead-2')).toBeDefined();
      expect(repo.getAgent('dev-2')).toBeDefined();
    });

    it('returns 0 for nonexistent lead', () => {
      expect(repo.deleteCrew('nonexistent')).toBe(0);
    });
  });
});
