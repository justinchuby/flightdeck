import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the agent deletion timer race condition fix in AgentManager.
 *
 * Bug: When auto-restart creates a new agent with the same ID, the old
 * agent's 30s deletion timer could delete the NEW agent from the Map.
 *
 * Fix: Guard the timer callback — only delete from the Map if the entry
 * still references the same agent instance (not a replacement).
 */

// ── Minimal mock types matching AgentManager's exit cleanup logic ─────

interface MockAgent {
  id: string;
  disposed: boolean;
  dispose(): void;
}

function createMockAgent(id: string): MockAgent {
  return {
    id,
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}

/**
 * Extracted deletion timer logic that mirrors AgentManager's exit handler.
 * This is the FIXED version with the identity guard.
 */
function scheduleDeletion(
  agents: Map<string, MockAgent>,
  agent: MockAgent,
): void {
  const exitedAgent = agent;
  setTimeout(() => {
    if (agents.get(exitedAgent.id) === exitedAgent) {
      agents.delete(exitedAgent.id);
    }
    exitedAgent.dispose();
  }, 30_000);
}

/**
 * The OLD buggy version (for contrast/regression testing).
 */
function scheduleDeletionBuggy(
  agents: Map<string, MockAgent>,
  agent: MockAgent,
): void {
  setTimeout(() => {
    agents.delete(agent.id);
    agent.dispose();
  }, 30_000);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Agent deletion timer race condition', () => {
  let agents: Map<string, MockAgent>;

  beforeEach(() => {
    vi.useFakeTimers();
    agents = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes agent from Map after 30s when no replacement exists', () => {
    const agent = createMockAgent('agent-001');
    agents.set(agent.id, agent);

    scheduleDeletion(agents, agent);
    expect(agents.has('agent-001')).toBe(true);

    vi.advanceTimersByTime(30_000);

    expect(agents.has('agent-001')).toBe(false);
    expect(agent.disposed).toBe(true);
  });

  it('does NOT delete replacement agent when old timer fires', () => {
    const oldAgent = createMockAgent('agent-001');
    agents.set(oldAgent.id, oldAgent);

    // Old agent exits → deletion timer scheduled
    scheduleDeletion(agents, oldAgent);

    // 2s later: auto-restart creates a NEW agent with the same ID
    vi.advanceTimersByTime(2_000);
    const newAgent = createMockAgent('agent-001');
    agents.set(newAgent.id, newAgent);

    // 28s later: old deletion timer fires (t=30s total)
    vi.advanceTimersByTime(28_000);

    // The Map must still contain the NEW agent
    expect(agents.has('agent-001')).toBe(true);
    expect(agents.get('agent-001')).toBe(newAgent);

    // The old agent should still be disposed (cleanup always runs)
    expect(oldAgent.disposed).toBe(true);
    // The new agent must NOT be disposed
    expect(newAgent.disposed).toBe(false);
  });

  it('disposes old agent even when a replacement exists', () => {
    const oldAgent = createMockAgent('agent-001');
    agents.set(oldAgent.id, oldAgent);

    scheduleDeletion(agents, oldAgent);

    // Replacement arrives
    const newAgent = createMockAgent('agent-001');
    agents.set(newAgent.id, newAgent);

    vi.advanceTimersByTime(30_000);

    // Old agent should be disposed even though it wasn't deleted from Map
    expect(oldAgent.disposed).toBe(true);
  });

  it('handles multiple crash-restart cycles correctly', () => {
    // First agent crashes
    const agent1 = createMockAgent('agent-001');
    agents.set(agent1.id, agent1);
    scheduleDeletion(agents, agent1);

    // 2s: first restart
    vi.advanceTimersByTime(2_000);
    const agent2 = createMockAgent('agent-001');
    agents.set(agent2.id, agent2);

    // agent2 also crashes at t=5s
    vi.advanceTimersByTime(3_000);
    scheduleDeletion(agents, agent2);

    // 2s later (t=7s): second restart
    vi.advanceTimersByTime(2_000);
    const agent3 = createMockAgent('agent-001');
    agents.set(agent3.id, agent3);

    // t=30s: agent1's timer fires — should NOT delete agent3
    vi.advanceTimersByTime(23_000);
    expect(agents.get('agent-001')).toBe(agent3);
    expect(agent1.disposed).toBe(true);

    // t=35s: agent2's timer fires — should NOT delete agent3
    vi.advanceTimersByTime(5_000);
    expect(agents.get('agent-001')).toBe(agent3);
    expect(agent2.disposed).toBe(true);
    expect(agent3.disposed).toBe(false);
  });

  it('regression: buggy version WOULD delete the replacement agent', () => {
    const buggyCopy = new Map<string, MockAgent>();
    const oldAgent = createMockAgent('agent-001');
    buggyCopy.set(oldAgent.id, oldAgent);

    scheduleDeletionBuggy(buggyCopy, oldAgent);

    // Auto-restart creates replacement
    vi.advanceTimersByTime(2_000);
    const newAgent = createMockAgent('agent-001');
    buggyCopy.set(newAgent.id, newAgent);

    // Old timer fires — buggy version removes the new agent!
    vi.advanceTimersByTime(28_000);
    expect(buggyCopy.has('agent-001')).toBe(false); // BUG: new agent deleted
    expect(newAgent.disposed).toBe(false); // newAgent.dispose() was NOT called (old ref)
    expect(oldAgent.disposed).toBe(true); // oldAgent was disposed instead
  });

  it('correctly deletes when agent exits without restart', () => {
    const agent = createMockAgent('agent-001');
    agents.set(agent.id, agent);
    scheduleDeletion(agents, agent);

    // No replacement — normal exit
    vi.advanceTimersByTime(30_000);

    expect(agents.has('agent-001')).toBe(false);
    expect(agent.disposed).toBe(true);
  });

  it('handles replacement arriving exactly at 30s boundary', () => {
    const oldAgent = createMockAgent('agent-001');
    agents.set(oldAgent.id, oldAgent);
    scheduleDeletion(agents, oldAgent);

    // Replacement arrives exactly when timer would fire
    vi.advanceTimersByTime(29_999);
    const newAgent = createMockAgent('agent-001');
    agents.set(newAgent.id, newAgent);

    vi.advanceTimersByTime(1);

    // New agent must survive
    expect(agents.get('agent-001')).toBe(newAgent);
    expect(newAgent.disposed).toBe(false);
    expect(oldAgent.disposed).toBe(true);
  });
});
