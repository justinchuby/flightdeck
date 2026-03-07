import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock AcpConnection ────────────────────────────────────────────
const mockPrompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
const mockCancel = vi.fn().mockResolvedValue(undefined);
vi.mock('../acp/AcpConnection.js', () => ({
  AcpConnection: vi.fn().mockImplementation(() => ({
    isConnected: true,
    isPrompting: false,
    promptingStartedAt: null,
    supportsImages: false,
    prompt: mockPrompt,
    cancel: mockCancel,
    on: vi.fn(),
    emit: vi.fn(),
    start: vi.fn(),
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/index.js', () => ({
  db: {},
  schema: {},
}));

import { Agent } from '../agents/Agent.js';
import type { ServerConfig } from '../config.js';

const testConfig: ServerConfig = {
  port: 3000,
  host: 'localhost',
  cliCommand: 'copilot',
  cliArgs: [],
  provider: 'copilot',
  sdkMode: false,
  maxConcurrentAgents: 10,
  dbPath: ':memory:',
};

function createTestAgent(): Agent {
  const agent = new Agent(
    { id: 'lead', name: 'lead', description: 'Lead agent', systemPrompt: 'system', color: '#fff', icon: '👤', builtIn: true },
    testConfig,
  );
  // Simulate ACP connection
  (agent as any).acpConnection = {
    isConnected: true,
    isPrompting: false,
    promptingStartedAt: null,
    supportsImages: false,
    prompt: mockPrompt,
    cancel: mockCancel,
  };
  return agent;
}

describe('User message priority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Agent.queueMessage with priority', () => {
    it('queues normal messages at the back', () => {
      const agent = createTestAgent();
      // Make agent busy so messages queue
      (agent as any).status = 'running';

      agent.queueMessage('agent-msg-1');
      agent.queueMessage('agent-msg-2');
      agent.queueMessage('agent-msg-3');

      const summaries = agent.getPendingMessageSummaries();
      expect(summaries).toEqual(['agent-msg-1', 'agent-msg-2', 'agent-msg-3']);
    });

    it('queues priority messages at the front', () => {
      const agent = createTestAgent();
      (agent as any).status = 'running';

      agent.queueMessage('agent-msg-1');
      agent.queueMessage('agent-msg-2');
      agent.queueMessage('user-msg-priority', { priority: true });

      const summaries = agent.getPendingMessageSummaries();
      expect(summaries[0]).toBe('user-msg-priority');
      expect(summaries[1]).toBe('agent-msg-1');
      expect(summaries[2]).toBe('agent-msg-2');
    });

    it('queues priority messages at front even when system paused', () => {
      const agent = createTestAgent();
      (agent as any).systemPaused = true;

      agent.queueMessage('agent-msg-1');
      agent.queueMessage('user-msg', { priority: true });

      const summaries = agent.getPendingMessageSummaries();
      expect(summaries[0]).toBe('user-msg');
      expect(summaries[1]).toBe('agent-msg-1');
    });

    it('sends priority message immediately when idle', () => {
      const agent = createTestAgent();
      (agent as any).status = 'idle';

      agent.queueMessage('user-msg', { priority: true });

      expect(mockPrompt).toHaveBeenCalledWith('user-msg', { priority: true });
    });

    it('sends normal message immediately when idle', () => {
      const agent = createTestAgent();
      (agent as any).status = 'idle';

      agent.queueMessage('agent-msg');

      expect(mockPrompt).toHaveBeenCalledWith('agent-msg', undefined);
    });
  });

  describe('Agent.write with priority', () => {
    it('passes priority option to AcpConnection.prompt', () => {
      const agent = createTestAgent();

      agent.write('user message', { priority: true });

      expect(mockPrompt).toHaveBeenCalledWith('user message', { priority: true });
    });

    it('sends without priority by default', () => {
      const agent = createTestAgent();

      agent.write('agent message');

      expect(mockPrompt).toHaveBeenCalledWith('agent message', undefined);
    });
  });

  describe('multiple priority messages maintain FIFO among themselves', () => {
    it('first priority message stays at front, second goes after it (FIFO)', () => {
      const agent = createTestAgent();
      (agent as any).status = 'running';

      agent.queueMessage('agent-msg-1');
      agent.queueMessage('user-msg-1', { priority: true });
      agent.queueMessage('agent-msg-2');
      agent.queueMessage('user-msg-2', { priority: true });

      const summaries = agent.getPendingMessageSummaries();
      // Priority messages maintain FIFO: user-msg-1 first, user-msg-2 second, then agents
      expect(summaries[0]).toBe('user-msg-1');
      expect(summaries[1]).toBe('user-msg-2');
      expect(summaries[2]).toBe('agent-msg-1');
      expect(summaries[3]).toBe('agent-msg-2');
    });

    it('three priority messages stay in insertion order', () => {
      const agent = createTestAgent();
      (agent as any).status = 'running';

      agent.queueMessage('normal-1');
      agent.queueMessage('priority-A', { priority: true });
      agent.queueMessage('priority-B', { priority: true });
      agent.queueMessage('normal-2');
      agent.queueMessage('priority-C', { priority: true });

      const summaries = agent.getPendingMessageSummaries();
      expect(summaries[0]).toBe('priority-A');
      expect(summaries[1]).toBe('priority-B');
      expect(summaries[2]).toBe('priority-C');
      expect(summaries[3]).toBe('normal-1');
      expect(summaries[4]).toBe('normal-2');
    });
  });

  describe('rate limiting', () => {
    it('drops non-priority messages when queue is full', () => {
      const agent = createTestAgent();
      (agent as any).status = 'running';

      // Fill queue to MAX_PENDING_MESSAGES (200)
      for (let i = 0; i < 200; i++) {
        agent.queueMessage(`msg-${i}`);
      }
      expect(agent.getPendingMessageSummaries().length).toBe(200);

      // Next non-priority message should be dropped
      agent.queueMessage('overflow-msg');
      expect(agent.getPendingMessageSummaries().length).toBe(200);
      expect(agent.getPendingMessageSummaries()).not.toContain('overflow-msg');
    });

    it('never drops priority messages even when queue is full', () => {
      const agent = createTestAgent();
      (agent as any).status = 'running';

      for (let i = 0; i < 200; i++) {
        agent.queueMessage(`msg-${i}`);
      }
      expect(agent.getPendingMessageSummaries().length).toBe(200);

      // Priority message must always get through
      agent.queueMessage('priority-overflow', { priority: true });
      expect(agent.getPendingMessageSummaries().length).toBe(201);
      expect(agent.getPendingMessageSummaries()[0]).toBe('priority-overflow');
    });

    it('allows messages again after queue drains', () => {
      const agent = createTestAgent();
      (agent as any).status = 'running';

      for (let i = 0; i < 200; i++) {
        agent.queueMessage(`msg-${i}`);
      }

      // Clear queue
      agent.clearPendingMessages();
      expect(agent.getPendingMessageSummaries().length).toBe(0);

      // Should accept messages again
      agent.queueMessage('after-clear');
      expect(agent.getPendingMessageSummaries().length).toBe(1);
      expect(agent.getPendingMessageSummaries()[0]).toBe('after-clear');
    });
  });
});
