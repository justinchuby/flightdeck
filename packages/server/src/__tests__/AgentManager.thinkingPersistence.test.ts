import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { ConversationStore } from '../db/ConversationStore.js';

/**
 * Tests that thinking messages are stored in the ConversationStore
 * with sender='thinking', ensuring they survive session resume.
 *
 * The actual AgentManager buffers thinking text and flushes it to the
 * ConversationStore. These tests verify the storage/retrieval layer
 * that makes thinking messages persist across page refreshes and
 * session resumes.
 */
describe('Thinking message persistence', () => {
  let db: Database;
  let store: ConversationStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('stores and retrieves thinking messages with correct sender', () => {
    const thread = store.createThread('agent-1');
    store.addMessage(thread.id, 'thinking', 'Let me analyze the code...');

    const messages = store.getRecentMessages('agent-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('thinking');
    expect(messages[0].content).toBe('Let me analyze the code...');
  });

  it('preserves thinking messages alongside agent and user messages', () => {
    const thread = store.createThread('agent-1');
    store.addMessage(thread.id, 'user', 'Fix the bug');
    store.addMessage(thread.id, 'thinking', 'I need to check the error handling...');
    store.addMessage(thread.id, 'agent', 'I found and fixed the issue.');

    // getMessages returns chronological order (ASC) for a single thread
    const messages = store.getMessages(thread.id);
    expect(messages).toHaveLength(3);
    expect(messages[0].sender).toBe('user');
    expect(messages[1].sender).toBe('thinking');
    expect(messages[2].sender).toBe('agent');
  });

  it('includes thinking messages in message history API response shape', () => {
    const thread = store.createThread('agent-1');
    store.addMessage(thread.id, 'thinking', 'Analyzing dependencies...');
    store.addMessage(thread.id, 'agent', 'Dependencies look fine.');

    // getMessages returns chronological order
    const messages = store.getMessages(thread.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].sender).toBe('thinking');
    expect(messages[0].content).toBe('Analyzing dependencies...');
    expect(messages[1].sender).toBe('agent');
  });

  it('thinking messages are not filtered by system message filter', () => {
    const thread = store.createThread('agent-1');
    store.addMessage(thread.id, 'system', 'Internal prompt context');
    store.addMessage(thread.id, 'thinking', 'Processing the request...');
    store.addMessage(thread.id, 'agent', 'Done.');

    // Simulate the API's default filtering: exclude system messages
    const all = store.getMessages(thread.id);
    const filtered = all.filter(m => m.sender !== 'system');

    expect(filtered).toHaveLength(2);
    expect(filtered[0].sender).toBe('thinking');
    expect(filtered[1].sender).toBe('agent');
  });
});
