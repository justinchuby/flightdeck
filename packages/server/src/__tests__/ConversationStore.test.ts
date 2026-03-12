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
});
