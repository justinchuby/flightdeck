import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../db/database.js';
import { MessageQueueStore } from '../MessageQueueStore.js';

describe('MessageQueueStore', () => {
  let db: Database;
  let store: MessageQueueStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new MessageQueueStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('enqueue', () => {
    it('inserts a message and returns a row ID', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{"text":"hello"}');
      expect(id).toBeGreaterThan(0);
    });

    it('stores all fields correctly', () => {
      store.enqueue('agent-1', 'delegation_result', '{"result":"ok"}', 'agent-2', 'proj-1');
      const pending = store.getPending('agent-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].targetAgentId).toBe('agent-1');
      expect(pending[0].sourceAgentId).toBe('agent-2');
      expect(pending[0].messageType).toBe('delegation_result');
      expect(pending[0].payload).toBe('{"result":"ok"}');
      expect(pending[0].status).toBe('queued');
      expect(pending[0].attempts).toBe(0);
      expect(pending[0].projectId).toBe('proj-1');
    });

    it('auto-increments IDs', () => {
      const id1 = store.enqueue('agent-1', 'broadcast', '{}');
      const id2 = store.enqueue('agent-1', 'broadcast', '{}');
      expect(id2).toBe(id1 + 1);
    });

    it('defaults sourceAgentId and projectId to null', () => {
      store.enqueue('agent-1', 'system', '{}');
      const msg = store.getPending('agent-1')[0];
      expect(msg.sourceAgentId).toBeNull();
      expect(msg.projectId).toBeNull();
    });
  });

  describe('markDelivered', () => {
    it('removes message from pending queue', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      expect(store.getPending('agent-1')).toHaveLength(1);

      store.markDelivered(id);
      expect(store.getPending('agent-1')).toHaveLength(0);
    });

    it('sets deliveredAt timestamp', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      store.markDelivered(id);

      // Query the raw row to check deliveredAt
      const row = db.get<{ delivered_at: string | null; status: string }>(
        'SELECT delivered_at, status FROM message_queue WHERE id = ?', [id]
      );
      expect(row?.delivered_at).toBeTruthy();
      expect(row?.status).toBe('delivered');
    });
  });

  describe('retry', () => {
    it('increments the attempts counter atomically', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      store.retry(id);
      store.retry(id);
      const msg = store.getPending('agent-1')[0];
      expect(msg.attempts).toBe(2);
    });

    it('does nothing for non-existent ID', () => {
      // Should not throw
      store.retry(99999);
    });

    it('auto-expires message after MAX_ATTEMPTS (10)', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      for (let i = 0; i < 9; i++) {
        expect(store.retry(id)).toBe(true);
      }
      // 10th retry should expire it
      expect(store.retry(id)).toBe(false);
      // Message should no longer be pending
      expect(store.getPending('agent-1')).toHaveLength(0);
    });
  });

  describe('getPending', () => {
    it('returns only queued messages for the target agent', () => {
      store.enqueue('agent-1', 'agent_message', '{"n":1}');
      store.enqueue('agent-2', 'agent_message', '{"n":2}');
      const id3 = store.enqueue('agent-1', 'broadcast', '{"n":3}');
      store.markDelivered(id3);

      const pending = store.getPending('agent-1');
      expect(pending).toHaveLength(1);
      expect(JSON.parse(pending[0].payload).n).toBe(1);
    });

    it('returns messages in FIFO order', () => {
      store.enqueue('agent-1', 'agent_message', '{"order":1}');
      store.enqueue('agent-1', 'agent_message', '{"order":2}');
      store.enqueue('agent-1', 'agent_message', '{"order":3}');

      const pending = store.getPending('agent-1');
      expect(pending.map(m => JSON.parse(m.payload).order)).toEqual([1, 2, 3]);
    });

    it('returns empty array when no pending messages', () => {
      expect(store.getPending('agent-1')).toEqual([]);
    });
  });

  describe('getPendingAll', () => {
    it('returns pending messages across all agents', () => {
      store.enqueue('agent-1', 'agent_message', '{}');
      store.enqueue('agent-2', 'broadcast', '{}');
      store.enqueue('agent-3', 'system', '{}');

      expect(store.getPendingAll()).toHaveLength(3);
    });

    it('excludes delivered messages', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      store.enqueue('agent-2', 'broadcast', '{}');
      store.markDelivered(id);

      expect(store.getPendingAll()).toHaveLength(1);
    });
  });

  describe('getPendingCount', () => {
    it('counts all pending when no agent specified', () => {
      store.enqueue('agent-1', 'agent_message', '{}');
      store.enqueue('agent-2', 'broadcast', '{}');
      expect(store.getPendingCount()).toBe(2);
    });

    it('counts pending for specific agent', () => {
      store.enqueue('agent-1', 'agent_message', '{}');
      store.enqueue('agent-1', 'broadcast', '{}');
      store.enqueue('agent-2', 'system', '{}');
      expect(store.getPendingCount('agent-1')).toBe(2);
      expect(store.getPendingCount('agent-2')).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('deletes delivered messages older than threshold', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      store.markDelivered(id);

      // Manually set deliveredAt to 10 days ago
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.run(`UPDATE message_queue SET delivered_at = ? WHERE id = ?`, [oldDate, id]);

      const deleted = store.cleanup(7);
      expect(deleted).toBe(1);
      expect(store.getPendingCount()).toBe(0);
    });

    it('preserves recent delivered messages', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');
      store.markDelivered(id);

      const deleted = store.cleanup(7);
      expect(deleted).toBe(0);
    });

    it('preserves queued (undelivered) messages regardless of age', () => {
      store.enqueue('agent-1', 'agent_message', '{}');

      // Even with cleanup, queued messages are untouched
      const deleted = store.cleanup(0);
      expect(deleted).toBe(0);
      expect(store.getPendingCount()).toBe(1);
    });
  });

  describe('expireStale', () => {
    it('expires old queued messages', () => {
      const id = store.enqueue('agent-1', 'agent_message', '{}');

      // Manually set createdAt to 5 days ago
      const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      db.run(`UPDATE message_queue SET created_at = ? WHERE id = ?`, [oldDate, id]);

      const expired = store.expireStale(3);
      expect(expired).toBe(1);
      expect(store.getPending('agent-1')).toHaveLength(0);
    });

    it('preserves recent queued messages', () => {
      store.enqueue('agent-1', 'agent_message', '{}');

      const expired = store.expireStale(3);
      expect(expired).toBe(0);
      expect(store.getPending('agent-1')).toHaveLength(1);
    });
  });
});
