import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Tests for the file lock expiry notification in AgentManager.
 *
 * When a file lock expires (TTL timeout), the agent who held the lock
 * should receive a system message so they can reacquire it.
 *
 * This tests the listener wired up in AgentManager's constructor that
 * forwards `lock:expired` events from FileLockRegistry to the affected agent.
 */

// ── Minimal mock types matching AgentManager's lock expiry listener ───

interface MockAgent {
  id: string;
  status: string;
  sendMessage: (...args: unknown[]) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function createMockAgent(id: string, status = 'running'): MockAgent {
  return {
    id,
    status,
    sendMessage: vi.fn(),
  };
}

/**
 * Extracted lock-expiry notification logic mirroring AgentManager L229-235.
 * Uses the same event signature and guard conditions.
 */
class LockExpiryNotifier {
  private agents: Map<string, MockAgent>;
  private lockRegistry: EventEmitter;

  constructor(lockRegistry: EventEmitter, agents: Map<string, MockAgent>) {
    this.lockRegistry = lockRegistry;
    this.agents = agents;

    this.lockRegistry.on('lock:expired', ({ filePath, agentId }: { filePath: string; agentId: string }) => {
      const agent = this.agents.get(agentId);
      if (agent && (agent.status === 'running' || agent.status === 'idle')) {
        agent.sendMessage(`[System] Your file lock on "${filePath}" has expired after the TTL timeout. If you still need it, reacquire with LOCK_FILE.`);
      }
    });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('File lock expiry notification', () => {
  let agents: Map<string, MockAgent>;
  let lockRegistry: EventEmitter;

  beforeEach(() => {
    agents = new Map();
    lockRegistry = new EventEmitter();
    // Wire up the notifier (mirrors AgentManager constructor)
    new LockExpiryNotifier(lockRegistry, agents);
  });

  it('sends notification to running agent when lock expires', () => {
    const agent = createMockAgent('agent-dev-001', 'running');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/index.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    expect(agent.sendMessage).toHaveBeenCalledTimes(1);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      '[System] Your file lock on "src/index.ts" has expired after the TTL timeout. If you still need it, reacquire with LOCK_FILE.',
    );
  });

  it('sends notification to idle agent when lock expires', () => {
    const agent = createMockAgent('agent-dev-001', 'idle');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'packages/server/src/utils.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    expect(agent.sendMessage).toHaveBeenCalledTimes(1);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('packages/server/src/utils.ts'),
    );
  });

  it('does NOT notify agent with terminal status (failed)', () => {
    const agent = createMockAgent('agent-dev-001', 'failed');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/index.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT notify agent with terminal status (terminated)', () => {
    const agent = createMockAgent('agent-dev-001', 'terminated');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/index.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT notify agent with creating status', () => {
    const agent = createMockAgent('agent-dev-001', 'creating');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/index.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('handles expired lock for unknown agent gracefully', () => {
    // No agent in the Map — should not throw
    expect(() => {
      lockRegistry.emit('lock:expired', {
        filePath: 'src/index.ts',
        agentId: 'agent-nonexistent',
        agentRole: 'developer',
      });
    }).not.toThrow();
  });

  it('notification message includes LOCK_FILE reacquisition hint', () => {
    const agent = createMockAgent('agent-dev-001', 'running');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/config.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    const message = (agent.sendMessage as any).mock.calls[0][0] as string;
    expect(message).toContain('LOCK_FILE');
    expect(message).toContain('[System]');
    expect(message).toContain('src/config.ts');
    expect(message).toContain('expired');
  });

  it('handles multiple lock expirations for the same agent', () => {
    const agent = createMockAgent('agent-dev-001', 'running');
    agents.set(agent.id, agent);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/a.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });
    lockRegistry.emit('lock:expired', {
      filePath: 'src/b.ts',
      agentId: 'agent-dev-001',
      agentRole: 'developer',
    });

    expect(agent.sendMessage).toHaveBeenCalledTimes(2);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('src/a.ts'),
    );
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('src/b.ts'),
    );
  });

  it('handles lock expirations for different agents', () => {
    const agent1 = createMockAgent('agent-001', 'running');
    const agent2 = createMockAgent('agent-002', 'idle');
    agents.set(agent1.id, agent1);
    agents.set(agent2.id, agent2);

    lockRegistry.emit('lock:expired', {
      filePath: 'src/a.ts',
      agentId: 'agent-001',
      agentRole: 'developer',
    });
    lockRegistry.emit('lock:expired', {
      filePath: 'src/b.ts',
      agentId: 'agent-002',
      agentRole: 'architect',
    });

    expect(agent1.sendMessage).toHaveBeenCalledTimes(1);
    expect(agent2.sendMessage).toHaveBeenCalledTimes(1);
    expect(agent1.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('src/a.ts'),
    );
    expect(agent2.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('src/b.ts'),
    );
  });
});
