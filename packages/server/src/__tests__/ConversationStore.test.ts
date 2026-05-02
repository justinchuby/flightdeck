import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { ConversationStore } from '../db/ConversationStore.js';

describe('ConversationStore', () => {
  let db: Database;
  let store: ConversationStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createThread', () => {
    it('creates a thread with correct agentId and taskId', () => {
      const thread = store.createThread('agent-1', 'task-42');
      expect(thread.agentId).toBe('agent-1');
      expect(thread.taskId).toBe('task-42');
      expect(thread.createdAt).toBeDefined();
    });

    it('generates a unique id', () => {
      const t1 = store.createThread('agent-1');
      const t2 = store.createThread('agent-1');
      expect(t1.id).toBeDefined();
      expect(t2.id).toBeDefined();
      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe('addMessage', () => {
    it('stores a message with correct conversationId and sender', () => {
      const thread = store.createThread('agent-1');
      const msg = store.addMessage(thread.id, 'user', 'Hello');
      expect(msg.conversationId).toBe(thread.id);
      expect(msg.sender).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
    });

    it('stores a message with fromRole for external messages', () => {
      const thread = store.createThread('agent-1');
      const msg = store.addMessage(thread.id, 'external', 'Agent DM content', 'Developer (abc12345)');
      expect(msg.sender).toBe('external');
      expect(msg.content).toBe('Agent DM content');
      expect(msg.fromRole).toBe('Developer (abc12345)');
    });

    it('stores fromRole as undefined when not provided', () => {
      const thread = store.createThread('agent-1');
      const msg = store.addMessage(thread.id, 'user', 'No role');
      expect(msg.fromRole).toBeUndefined();
    });
  });

  describe('getThreadsByAgent', () => {
    it('returns threads for the given agent', () => {
      store.createThread('agent-1', 'task-1');
      store.createThread('agent-1', 'task-2');

      const threads = store.getThreadsByAgent('agent-1');
      expect(threads.length).toBe(2);
      expect(threads.every((t) => t.agentId === 'agent-1')).toBe(true);
    });

    it("doesn't return threads for other agents", () => {
      store.createThread('agent-1');
      store.createThread('agent-2');

      const threads = store.getThreadsByAgent('agent-1');
      expect(threads.length).toBe(1);
      expect(threads[0].agentId).toBe('agent-1');
    });
  });

  describe('getMessages', () => {
    it('returns messages in chronological order', () => {
      const thread = store.createThread('agent-1');
      store.addMessage(thread.id, 'user', 'First');
      store.addMessage(thread.id, 'assistant', 'Second');
      store.addMessage(thread.id, 'user', 'Third');

      const messages = store.getMessages(thread.id);
      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('respects the limit parameter', () => {
      const thread = store.createThread('agent-1');
      for (let i = 0; i < 10; i++) {
        store.addMessage(thread.id, 'user', `Message ${i}`);
      }

      const messages = store.getMessages(thread.id, 3);
      expect(messages.length).toBe(3);
    });

    it('returns fromRole for external messages', () => {
      const thread = store.createThread('agent-1');
      store.addMessage(thread.id, 'external', 'DM content', 'Developer (abc12345)');
      store.addMessage(thread.id, 'agent', 'Response');

      const messages = store.getMessages(thread.id);
      expect(messages[0].sender).toBe('external');
      expect(messages[0].fromRole).toBe('Developer (abc12345)');
      expect(messages[1].sender).toBe('agent');
      expect(messages[1].fromRole).toBeUndefined();
    });
  });

  describe('getRecentMessages', () => {
    it('returns messages across all conversations for an agent', () => {
      const t1 = store.createThread('agent-1');
      const t2 = store.createThread('agent-1');
      store.addMessage(t1.id, 'user', 'From thread 1');
      store.addMessage(t2.id, 'user', 'From thread 2');

      const messages = store.getRecentMessages('agent-1');
      expect(messages.length).toBe(2);
      const contents = messages.map((m) => m.content);
      expect(contents).toContain('From thread 1');
      expect(contents).toContain('From thread 2');
    });

    it('respects the limit parameter', () => {
      const thread = store.createThread('agent-1');
      for (let i = 0; i < 10; i++) {
        store.addMessage(thread.id, 'user', `Message ${i}`);
      }

      const messages = store.getRecentMessages('agent-1', 5);
      expect(messages.length).toBe(5);
    });

    it('returns fromRole for external messages', () => {
      const thread = store.createThread('agent-1');
      store.addMessage(thread.id, 'external', 'Agent DM', 'Reviewer (def67890)');

      const messages = store.getRecentMessages('agent-1');
      expect(messages.length).toBe(1);
      expect(messages[0].sender).toBe('external');
      expect(messages[0].fromRole).toBe('Reviewer (def67890)');
    });
  });

  describe('getMessagesBefore', () => {
    it('returns messages older than the cursor ID', () => {
      const thread = store.createThread('agent-1');
      const m1 = store.addMessage(thread.id, 'user', 'First');
      const m2 = store.addMessage(thread.id, 'agent', 'Second');
      const m3 = store.addMessage(thread.id, 'user', 'Third');

      // getMessagesBefore returns desc order (newest first) — caller reverses
      const before = store.getMessagesBefore('agent-1', m3.id);
      expect(before.length).toBe(2);
      expect(before[0].content).toBe('Second');
      expect(before[1].content).toBe('First');
    });

    it('respects the limit parameter', () => {
      const thread = store.createThread('agent-1');
      for (let i = 0; i < 10; i++) {
        store.addMessage(thread.id, 'user', `Message ${i}`);
      }
      const allMsgs = store.getRecentMessages('agent-1', 100);
      const lastId = allMsgs[0].id; // highest ID (desc order)

      const before = store.getMessagesBefore('agent-1', lastId, 3);
      expect(before.length).toBe(3);
    });

    it('returns empty array when no older messages exist', () => {
      const thread = store.createThread('agent-1');
      const m1 = store.addMessage(thread.id, 'user', 'Only message');

      const before = store.getMessagesBefore('agent-1', m1.id);
      expect(before.length).toBe(0);
    });

    it('does not return messages from other agents', () => {
      const t1 = store.createThread('agent-1');
      const t2 = store.createThread('agent-2');
      store.addMessage(t1.id, 'user', 'Agent 1 msg');
      store.addMessage(t2.id, 'user', 'Agent 2 msg');
      const m3 = store.addMessage(t1.id, 'user', 'Agent 1 msg 2');

      const before = store.getMessagesBefore('agent-1', m3.id);
      expect(before.length).toBe(1);
      expect(before[0].content).toBe('Agent 1 msg');
    });

    it('preserves fromRole in paginated results', () => {
      const thread = store.createThread('agent-1');
      store.addMessage(thread.id, 'external', 'DM content', 'Developer (abc12345)');
      const m2 = store.addMessage(thread.id, 'agent', 'Response');

      const before = store.getMessagesBefore('agent-1', m2.id);
      expect(before.length).toBe(1);
      expect(before[0].fromRole).toBe('Developer (abc12345)');
    });
  });
});
