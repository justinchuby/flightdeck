import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { wireReconciliationOnReconnect } from '../../container.js';
import type { AgentServerClient } from '../AgentServerClient.js';
import type { AgentManager } from '../AgentManager.js';
import type { AgentInfo } from '../../transport/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function createMockAgentServerClient(agents: AgentInfo[] = []): AgentServerClient & EventEmitter {
  const emitter = new EventEmitter() as AgentServerClient & EventEmitter;
  emitter.list = vi.fn().mockResolvedValue(agents);
  emitter.getLastSeenEventId = vi.fn().mockReturnValue(undefined);
  return emitter;
}

function createMockAgentManager(agents: Array<{ id: string; role: { id: string }; model: string; status: string }>): AgentManager {
  return {
    getAll: vi.fn().mockReturnValue(agents),
  } as unknown as AgentManager;
}

function makeAgentInfo(overrides: Partial<AgentInfo> & { agentId: string }): AgentInfo {
  return {
    role: 'developer',
    model: 'gpt-4',
    status: 'running',
    pid: 1234,
    spawnedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('wireReconciliationOnReconnect', () => {
  let client: AgentServerClient & EventEmitter;
  let manager: AgentManager;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT run reconciliation on the initial connect', async () => {
    const serverAgents = [makeAgentInfo({ agentId: 'a1' })];
    client = createMockAgentServerClient(serverAgents);
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    // First connect — should skip reconciliation
    client.emit('connected');
    await vi.advanceTimersByTimeAsync(0);

    expect(client.list).not.toHaveBeenCalled();
  });

  it('runs reconciliation on the second connect (reconnect)', async () => {
    const serverAgents = [makeAgentInfo({ agentId: 'a1', status: 'running' })];
    client = createMockAgentServerClient(serverAgents);
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    // First connect — skip
    client.emit('connected');
    await vi.advanceTimersByTimeAsync(0);

    // Second connect (reconnect) — should trigger reconciliation
    client.emit('connected');
    await vi.advanceTimersByTimeAsync(0);

    expect(client.list).toHaveBeenCalledTimes(1);
  });

  it('skips reconciliation when there are no non-terminal agents', async () => {
    client = createMockAgentServerClient([]);
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'completed' },
      { id: 'a2', role: { id: 'architect' }, model: 'gpt-4', status: 'terminated' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    client.emit('connected'); // initial
    client.emit('connected'); // reconnect
    await vi.advanceTimersByTimeAsync(0);

    // All agents are terminal, so reconciliation should not query the server
    expect(client.list).not.toHaveBeenCalled();
  });

  it('builds expected agents from non-terminal agents only', async () => {
    const serverAgents = [
      makeAgentInfo({ agentId: 'a1', status: 'running' }),
      makeAgentInfo({ agentId: 'a3', status: 'idle' }),
    ];
    client = createMockAgentServerClient(serverAgents);
    (client.getLastSeenEventId as ReturnType<typeof vi.fn>)
      .mockImplementation((id: string) => id === 'a1' ? 'evt-42' : undefined);

    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
      { id: 'a2', role: { id: 'architect' }, model: 'claude-3', status: 'completed' },
      { id: 'a3', role: { id: 'tester' }, model: 'gpt-4', status: 'running' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    client.emit('connected'); // initial
    client.emit('connected'); // reconnect
    await vi.advanceTimersByTimeAsync(0);

    // client.list is called by AgentReconciliation.reconcile()
    expect(client.list).toHaveBeenCalledTimes(1);
    // Verify getLastSeenEventId was called for non-terminal agents
    expect(client.getLastSeenEventId).toHaveBeenCalledWith('a1');
    expect(client.getLastSeenEventId).toHaveBeenCalledWith('a3');
  });

  it('broadcasts reconciliation report via WebSocket', async () => {
    const serverAgents = [makeAgentInfo({ agentId: 'a1', status: 'running' })];
    client = createMockAgentServerClient(serverAgents);
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
    ]);
    const wsServer = { broadcastEvent: vi.fn() };

    wireReconciliationOnReconnect(client, manager, wsServer);

    client.emit('connected'); // initial
    client.emit('connected'); // reconnect
    await vi.advanceTimersByTimeAsync(0);

    expect(wsServer.broadcastEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reconciliation:complete',
        report: expect.objectContaining({
          reconnected: expect.any(Array),
          lost: expect.any(Array),
          discovered: expect.any(Array),
          reconciledAt: expect.any(Number),
        }),
      }),
    );
  });

  it('handles reconciliation errors gracefully (does not throw)', async () => {
    client = createMockAgentServerClient([]);
    (client.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection lost'));
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    client.emit('connected'); // initial
    // Reconnect with failing client — should not throw
    client.emit('connected');
    await vi.advanceTimersByTimeAsync(0);

    expect(client.list).toHaveBeenCalledTimes(1);
  });

  it('runs reconciliation on every reconnect (not just the first)', async () => {
    const serverAgents = [makeAgentInfo({ agentId: 'a1', status: 'running' })];
    client = createMockAgentServerClient(serverAgents);
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    client.emit('connected'); // initial — skip
    client.emit('connected'); // 1st reconnect
    await vi.advanceTimersByTimeAsync(0);
    client.emit('connected'); // 2nd reconnect
    await vi.advanceTimersByTimeAsync(0);
    client.emit('connected'); // 3rd reconnect
    await vi.advanceTimersByTimeAsync(0);

    expect(client.list).toHaveBeenCalledTimes(3);
  });

  it('prevents concurrent reconciliation on rapid reconnects', async () => {
    // Use a deferred promise so reconcile() stays in-flight
    let resolveList!: (value: any) => void;
    const serverAgents = [makeAgentInfo({ agentId: 'a1', status: 'running' })];
    client = createMockAgentServerClient(serverAgents);
    (client.list as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(resolve => { resolveList = resolve; }),
    );
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'developer' }, model: 'gpt-4', status: 'running' },
    ]);

    wireReconciliationOnReconnect(client, manager);

    client.emit('connected'); // initial — skip
    client.emit('connected'); // 1st reconnect — starts reconciliation
    client.emit('connected'); // 2nd reconnect — should be skipped (still reconciling)
    client.emit('connected'); // 3rd reconnect — should be skipped (still reconciling)

    // Only 1 call should have been made (the 1st reconnect)
    expect(client.list).toHaveBeenCalledTimes(1);

    // Now resolve the in-flight reconciliation
    resolveList(serverAgents);
    await vi.advanceTimersByTimeAsync(0);

    // After resolving, the next reconnect should work
    client.emit('connected'); // 4th reconnect — should proceed
    await vi.advanceTimersByTimeAsync(0);

    expect(client.list).toHaveBeenCalledTimes(2);
  });

  it('returns an unsubscribe function that removes the listener', async () => {
    const serverAgents = [makeAgentInfo({ agentId: 'a1' })];
    client = createMockAgentServerClient(serverAgents);
    manager = createMockAgentManager([
      { id: 'a1', role: { id: 'dev' }, model: 'gpt-4', status: 'running' },
    ]);

    const unsubscribe = wireReconciliationOnReconnect(client, manager);

    // Initial connect (skipped)
    client.emit('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.list).not.toHaveBeenCalled();

    // Unsubscribe
    unsubscribe();

    // Reconnect after unsubscribe — handler should NOT run
    client.emit('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(client.list).not.toHaveBeenCalled();
  });
});
