import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';

describe('ActiveDelegationRepository', () => {
  let db: Database;
  let delegationRepo: ActiveDelegationRepository;
  let rosterRepo: AgentRosterRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    delegationRepo = new ActiveDelegationRepository(db);
    rosterRepo = new AgentRosterRepository(db);
    // activeDelegations has a FK to agentRoster, so create the parent first
    rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet');
    rosterRepo.upsertAgent('agent-2', 'lead', 'gpt-4');
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a delegation with required fields', () => {
      const d = delegationRepo.create('del-1', 'agent-1', 'Build the API');
      expect(d.delegationId).toBe('del-1');
      expect(d.agentId).toBe('agent-1');
      expect(d.task).toBe('Build the API');
      expect(d.status).toBe('active');
      expect(d.createdAt).toBeDefined();
      expect(d.completedAt).toBeUndefined();
    });

    it('creates a delegation with optional fields', () => {
      const d = delegationRepo.create(
        'del-2', 'agent-1', 'Write tests',
        'Context about the feature', 'dag-task-42',
      );
      expect(d.context).toBe('Context about the feature');
      expect(d.dagTaskId).toBe('dag-task-42');
    });

    it('enforces foreign key to agentRoster', () => {
      expect(() => {
        delegationRepo.create('del-bad', 'nonexistent-agent', 'Some task');
      }).toThrow();
    });
  });

  describe('complete', () => {
    it('marks delegation as completed with result', () => {
      delegationRepo.create('del-1', 'agent-1', 'Build the API');
      const completed = delegationRepo.complete('del-1', { output: 'success', files: 3 });
      expect(completed).toBe(true);

      const d = delegationRepo.getByDelegationId('del-1');
      expect(d!.status).toBe('completed');
      expect(d!.completedAt).toBeDefined();
      expect(d!.result).toEqual({ output: 'success', files: 3 });
    });

    it('marks delegation as completed without result', () => {
      delegationRepo.create('del-1', 'agent-1', 'Build the API');
      delegationRepo.complete('del-1');

      const d = delegationRepo.getByDelegationId('del-1');
      expect(d!.status).toBe('completed');
      expect(d!.result).toBeUndefined();
    });

    it('returns false for non-existent delegation', () => {
      const result = delegationRepo.complete('does-not-exist');
      expect(result).toBe(false);
    });
  });

  describe('fail', () => {
    it('marks delegation as failed with error info', () => {
      delegationRepo.create('del-1', 'agent-1', 'Build the API');
      delegationRepo.fail('del-1', { error: 'Compilation failed' });

      const d = delegationRepo.getByDelegationId('del-1');
      expect(d!.status).toBe('failed');
      expect(d!.completedAt).toBeDefined();
      expect(d!.result).toEqual({ error: 'Compilation failed' });
    });

    it('returns false for non-existent delegation', () => {
      expect(delegationRepo.fail('does-not-exist')).toBe(false);
    });
  });

  describe('cancel', () => {
    it('marks delegation as cancelled', () => {
      delegationRepo.create('del-1', 'agent-1', 'Build the API');
      delegationRepo.cancel('del-1');

      const d = delegationRepo.getByDelegationId('del-1');
      expect(d!.status).toBe('cancelled');
      expect(d!.completedAt).toBeDefined();
    });

    it('returns false for non-existent delegation', () => {
      expect(delegationRepo.cancel('does-not-exist')).toBe(false);
    });
  });

  describe('getActive', () => {
    beforeEach(() => {
      delegationRepo.create('del-1', 'agent-1', 'Task A');
      delegationRepo.create('del-2', 'agent-1', 'Task B');
      delegationRepo.create('del-3', 'agent-2', 'Task C');
      delegationRepo.complete('del-2');
    });

    it('returns all active delegations when no agent filter', () => {
      const active = delegationRepo.getActive();
      expect(active.length).toBe(2);
      const ids = active.map((d) => d.delegationId);
      expect(ids).toContain('del-1');
      expect(ids).toContain('del-3');
    });

    it('filters active delegations by agent', () => {
      const active = delegationRepo.getActive('agent-1');
      expect(active.length).toBe(1);
      expect(active[0].delegationId).toBe('del-1');
    });

    it('returns empty array when agent has no active delegations', () => {
      delegationRepo.complete('del-1');
      const active = delegationRepo.getActive('agent-1');
      expect(active.length).toBe(0);
    });
  });

  describe('getByDagTask', () => {
    it('finds delegation by DAG task ID', () => {
      delegationRepo.create('del-1', 'agent-1', 'Build API', undefined, 'dag-42');
      const d = delegationRepo.getByDagTask('dag-42');
      expect(d).toBeDefined();
      expect(d!.delegationId).toBe('del-1');
      expect(d!.dagTaskId).toBe('dag-42');
    });

    it('returns undefined for non-existent DAG task', () => {
      const d = delegationRepo.getByDagTask('nonexistent');
      expect(d).toBeUndefined();
    });
  });

  describe('getByDelegationId', () => {
    it('retrieves delegation by its ID', () => {
      delegationRepo.create('del-1', 'agent-1', 'Build the API');
      const d = delegationRepo.getByDelegationId('del-1');
      expect(d).toBeDefined();
      expect(d!.task).toBe('Build the API');
    });

    it('returns undefined for non-existent ID', () => {
      expect(delegationRepo.getByDelegationId('nope')).toBeUndefined();
    });
  });

  describe('getAllByAgent', () => {
    it('returns all delegations for agent regardless of status', () => {
      delegationRepo.create('del-1', 'agent-1', 'Task A');
      delegationRepo.create('del-2', 'agent-1', 'Task B');
      delegationRepo.complete('del-1');
      delegationRepo.fail('del-2', { error: 'oops' });

      const all = delegationRepo.getAllByAgent('agent-1');
      expect(all.length).toBe(2);
      expect(all.map((d) => d.status)).toContain('completed');
      expect(all.map((d) => d.status)).toContain('failed');
    });

    it('returns empty array for agent with no delegations', () => {
      expect(delegationRepo.getAllByAgent('agent-2').length).toBe(0);
    });
  });

  describe('delegation lifecycle integration', () => {
    it('tracks delegation through create → active → complete', () => {
      // Create delegation
      delegationRepo.create('del-1', 'agent-1', 'Implement feature', 'Full context', 'dag-10');

      // Verify it appears in active
      expect(delegationRepo.getActive('agent-1').length).toBe(1);

      // Complete it
      delegationRepo.complete('del-1', { summary: 'Done' });

      // No longer active
      expect(delegationRepo.getActive('agent-1').length).toBe(0);

      // But still retrievable
      const d = delegationRepo.getByDelegationId('del-1');
      expect(d!.status).toBe('completed');
      expect(d!.result).toEqual({ summary: 'Done' });
    });

    it('handles multiple delegations for same agent', () => {
      delegationRepo.create('del-1', 'agent-1', 'Task 1');
      delegationRepo.create('del-2', 'agent-1', 'Task 2');
      delegationRepo.create('del-3', 'agent-1', 'Task 3');

      expect(delegationRepo.getActive('agent-1').length).toBe(3);

      delegationRepo.complete('del-1');
      delegationRepo.fail('del-2');

      expect(delegationRepo.getActive('agent-1').length).toBe(1);
      expect(delegationRepo.getAllByAgent('agent-1').length).toBe(3);
    });
  });
});
