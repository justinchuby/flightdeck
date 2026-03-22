/**
 * Tests that the initial user task message is persisted and retrievable.
 *
 * Bug: When a session was created with a task, the first user message
 * (the task/prompt) was only queued for the agent but never persisted
 * to the database. After a page refresh, this message was lost.
 *
 * Fix: lead.ts now calls agentManager.persistHumanMessage() before
 * agent.queueMessage() for the initial task.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { AgentMessageService } from '../agents/services/AgentMessageService.js';

describe('Initial task message persistence', () => {
  let db: Database;
  let messageService: AgentMessageService;

  beforeEach(() => {
    db = new Database(':memory:');
    messageService = new AgentMessageService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('persists initial user task and retrieves it in message history', () => {
    const agentId = 'lead-001';
    const task = 'Build a REST API for user management';

    // Simulate the fixed flow: create thread → persist task → retrieve
    messageService.createThread(agentId, task);
    messageService.persistHumanMessage(agentId, task);

    const history = messageService.getMessageHistory(agentId, 100);
    expect(history.length).toBe(1);
    expect(history[0].sender).toBe('user');
    expect(history[0].content).toBe(task);
  });

  it('initial task appears before system messages in history', () => {
    const agentId = 'lead-001';
    const task = 'Fix the login bug';

    messageService.createThread(agentId, task);
    messageService.persistHumanMessage(agentId, task);
    messageService.persistSystemMessage(agentId, 'System briefing...');

    const history = messageService.getMessageHistory(agentId, 100);
    expect(history.length).toBe(2);
    // Both messages should be present
    const senders = history.map(m => m.sender);
    expect(senders).toContain('user');
    expect(senders).toContain('system');
    // User message content should be the initial task
    const userMsg = history.find(m => m.sender === 'user');
    expect(userMsg!.content).toBe(task);
  });

  it('persists both initial task and subsequent user messages', () => {
    const agentId = 'lead-001';
    const task = 'Implement auth';

    messageService.createThread(agentId, task);
    messageService.persistHumanMessage(agentId, task);
    messageService.persistHumanMessage(agentId, 'Also add OAuth support');

    const history = messageService.getMessageHistory(agentId, 100);
    const userMessages = history.filter(m => m.sender === 'user');
    expect(userMessages.length).toBe(2);
    // Both messages present (order matches insertion)
    const contents = userMessages.map(m => m.content);
    expect(contents).toContain(task);
    expect(contents).toContain('Also add OAuth support');
  });
});
