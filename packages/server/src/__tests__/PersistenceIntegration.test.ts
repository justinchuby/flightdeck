import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { MessageQueueStore } from '../persistence/MessageQueueStore.js';
import { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';

/**
 * Integration tests verifying that persistence repositories work correctly
 * when used together in the patterns expected by the runtime wiring.
 */
describe('Persistence Repository Integration', () => {
  let db: Database;
  let mqStore: MessageQueueStore;
  let rosterRepo: AgentRosterRepository;
  let delegationRepo: ActiveDelegationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    mqStore = new MessageQueueStore(db);
    rosterRepo = new AgentRosterRepository(db);
    delegationRepo = new ActiveDelegationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('Message Queue — write-on-enqueue pattern', () => {
    it('persists message BEFORE delivery, marks delivered AFTER', () => {
      // Simulate: agent is busy, message is queued
      const mqId = mqStore.enqueue('agent-1', 'agent_message', '{"text":"do something"}');
      expect(mqId).toBeGreaterThan(0);

      // Message should be pending
      const pending = mqStore.getPending('agent-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('queued');

      // Simulate: agent becomes idle, message delivered
      mqStore.markDelivered(mqId);
      expect(mqStore.getPending('agent-1')).toHaveLength(0);
    });

    it('survives simulated crash — pending messages persist', () => {
      // Enqueue messages (simulating write-on-enqueue)
      mqStore.enqueue('agent-1', 'delegation_result', '{"result":"ok"}', 'agent-2');
      mqStore.enqueue('agent-1', 'broadcast', '{"text":"announcement"}');
      mqStore.enqueue('agent-2', 'system', '{"msg":"timer fired"}');

      // Simulate crash: create new store instances on same DB
      const mqStore2 = new MessageQueueStore(db);

      // All messages still pending
      expect(mqStore2.getPendingAll()).toHaveLength(3);
      expect(mqStore2.getPending('agent-1')).toHaveLength(2);
      expect(mqStore2.getPending('agent-2')).toHaveLength(1);
    });

    it('handles retry tracking for failed deliveries', () => {
      const mqId = mqStore.enqueue('agent-1', 'agent_message', '{}');

      // First delivery attempt fails
      mqStore.retry(mqId);
      expect(mqStore.getPending('agent-1')[0].attempts).toBe(1);

      // Second attempt fails
      mqStore.retry(mqId);
      expect(mqStore.getPending('agent-1')[0].attempts).toBe(2);

      // Third attempt succeeds
      mqStore.markDelivered(mqId);
      expect(mqStore.getPending('agent-1')).toHaveLength(0);
    });
  });

  describe('Agent Roster — lifecycle tracking', () => {
    it('tracks agent through spawn → busy → idle → terminated lifecycle', () => {
      // Spawn
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle', undefined, 'proj-1');
      let agent = rosterRepo.getAgent('agent-1');
      expect(agent?.status).toBe('idle');
      expect(agent?.role).toBe('developer');

      // Busy (received task)
      rosterRepo.updateStatus('agent-1', 'running');
      agent = rosterRepo.getAgent('agent-1');
      expect(agent?.status).toBe('running');

      // Idle (task complete)
      rosterRepo.updateStatus('agent-1', 'idle');
      agent = rosterRepo.getAgent('agent-1');
      expect(agent?.status).toBe('idle');

      // Terminated
      rosterRepo.updateStatus('agent-1', 'terminated');
      agent = rosterRepo.getAgent('agent-1');
      expect(agent?.status).toBe('terminated');
    });

    it('upsert handles re-spawn of same agent ID', () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-sonnet', 'idle');
      rosterRepo.updateStatus('agent-1', 'terminated');

      // Re-spawn with same ID (resume scenario)
      rosterRepo.upsertAgent('agent-1', 'developer', 'claude-opus', 'idle');
      const agent = rosterRepo.getAgent('agent-1');
      expect(agent?.status).toBe('idle');
      expect(agent?.model).toBe('claude-opus');
    });
  });

  describe('Active Delegations — full lifecycle', () => {
    it('tracks delegation from creation through completion', () => {
      // Agent must exist in roster first (FK constraint)
      rosterRepo.upsertAgent('agent-1', 'developer', 'sonnet', 'idle');

      // Create delegation
      delegationRepo.create('del-1', 'agent-1', 'implement feature X', 'context here', 'dag-task-1');
      const active = delegationRepo.getActive('agent-1');
      expect(active).toHaveLength(1);
      expect(active[0].task).toBe('implement feature X');

      // Complete delegation
      delegationRepo.complete('del-1', { summary: 'done' });
      expect(delegationRepo.getActive('agent-1')).toHaveLength(0);
    });

    it('tracks delegation failure', () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'sonnet', 'idle');
      delegationRepo.create('del-2', 'agent-1', 'risky task');
      delegationRepo.fail('del-2', { error: 'crashed' });
      expect(delegationRepo.getActive('agent-1')).toHaveLength(0);

      const byDag = delegationRepo.getByDelegationId('del-2');
      expect(byDag?.status).toBe('failed');
    });

    it('tracks delegation cancellation', () => {
      rosterRepo.upsertAgent('agent-1', 'developer', 'sonnet', 'idle');
      delegationRepo.create('del-3', 'agent-1', 'cancelled task');
      delegationRepo.cancel('del-3');
      expect(delegationRepo.getActive('agent-1')).toHaveLength(0);

      const record = delegationRepo.getByDelegationId('del-3');
      expect(record?.status).toBe('cancelled');
    });
  });

  describe('Cross-repository coordination', () => {
    it('agent roster + delegation + message queue work together', () => {
      // Spawn agent
      rosterRepo.upsertAgent('dev-1', 'developer', 'sonnet', 'idle', undefined, 'proj-1');

      // Delegate task → agent goes busy
      delegationRepo.create('del-100', 'dev-1', 'build feature');
      rosterRepo.updateStatus('dev-1', 'running');

      // Queue a message while agent is busy (write-on-enqueue)
      const mqId = mqStore.enqueue('dev-1', 'agent_message', '{"text":"status update"}', 'lead-1', 'proj-1');

      // Agent completes task → mark delegation done, deliver message, go idle
      delegationRepo.complete('del-100');
      mqStore.markDelivered(mqId);
      rosterRepo.updateStatus('dev-1', 'idle');

      // Verify final state
      expect(rosterRepo.getAgent('dev-1')?.status).toBe('idle');
      expect(delegationRepo.getActive('dev-1')).toHaveLength(0);
      expect(mqStore.getPending('dev-1')).toHaveLength(0);
    });
  });
});
