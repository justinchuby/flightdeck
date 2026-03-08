/**
 * AgentReconciliation — Orchestrator-side reconciliation after reconnect.
 *
 * Compares what the DAG/task-state expects to be running against what the
 * agent server actually reports.  Returns a structured report:
 *   - reconnected: expected AND running on agent server
 *   - lost:        expected but NOT on agent server (crashed / server restarted)
 *   - discovered:  on agent server but NOT expected (from another session, etc.)
 *
 * Usage:
 *   const reconciler = new AgentReconciliation(agentServerClient);
 *   const report = await reconciler.reconcile(expectedAgents);
 */

import type { AgentServerClient } from './AgentServerClient.js';

// ── Public types ────────────────────────────────────────────────────

/** What the orchestrator expects to be running. */
export interface ExpectedAgent {
  agentId: string;
  role: string;
  model: string;
  /** Last event ID seen locally — used for replay gap detection. */
  lastSeenEventId?: string;
}

/** An agent found on the agent server that matches an expected agent. */
export interface ReconnectedAgent {
  agentId: string;
  role: string;
  model: string;
  status: string;
  sessionId?: string;
  /** The expected agent's lastSeenEventId (caller can use this for replay). */
  lastSeenEventId?: string;
}

/** An agent found on the agent server that was NOT expected. */
export interface DiscoveredAgent {
  agentId: string;
  role: string;
  model: string;
  status: string;
  sessionId?: string;
  task?: string;
}

export interface ReconciliationReport {
  /** Agents found in both expected set and agent server (successful reconnect). */
  reconnected: ReconnectedAgent[];
  /** Agent IDs that were expected but not found on the agent server. */
  lost: string[];
  /** Agents on the agent server that were not expected. */
  discovered: DiscoveredAgent[];
  /** Timestamp when reconciliation completed. */
  reconciledAt: number;
}

// ── AgentReconciliation ─────────────────────────────────────────────

export class AgentReconciliation {
  constructor(private readonly client: AgentServerClient) {}

  /**
   * Compare expected agents against what the agent server reports.
   *
   * @param expectedAgents - Agents the orchestrator expects to be running.
   * @returns Structured reconciliation report.
   */
  async reconcile(expectedAgents: ExpectedAgent[]): Promise<ReconciliationReport> {
    // 1. Fetch actual agents from the agent server
    const actualAgents = await this.client.list();

    // 2. Index actual agents by ID for O(1) lookup
    const actualMap = new Map(actualAgents.map((a) => [a.agentId, a]));

    // 3. Index expected agents by ID
    const expectedMap = new Map(expectedAgents.map((a) => [a.agentId, a]));

    // 4. Walk expected → classify as reconnected or lost
    const reconnected: ReconnectedAgent[] = [];
    const lost: string[] = [];

    for (const expected of expectedAgents) {
      const actual = actualMap.get(expected.agentId);
      if (actual && !isTerminalStatus(actual.status)) {
        reconnected.push({
          agentId: expected.agentId,
          role: actual.role,
          model: actual.model,
          status: actual.status,
          sessionId: actual.sessionId,
          lastSeenEventId: expected.lastSeenEventId,
        });
      } else {
        lost.push(expected.agentId);
      }
    }

    // 5. Walk actual → find discovered (not in expected, not terminal)
    const discovered: DiscoveredAgent[] = [];
    for (const actual of actualAgents) {
      if (!expectedMap.has(actual.agentId) && !isTerminalStatus(actual.status)) {
        discovered.push({
          agentId: actual.agentId,
          role: actual.role,
          model: actual.model,
          status: actual.status,
          sessionId: actual.sessionId,
          task: actual.task,
        });
      }
    }

    return {
      reconnected,
      lost,
      discovered,
      reconciledAt: Date.now(),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['exited', 'crashed']);

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}
