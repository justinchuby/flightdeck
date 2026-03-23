// ── Short Agent ID ────────────────────────────────────────────────

/** Standard short ID length (8 hex chars — sufficient uniqueness for UUIDs). */
export const SHORT_ID_LENGTH = 8;

/** Shorten an agent ID for display or log attribution. Default 8 chars. */
export function shortAgentId(agentId: string, length: number = SHORT_ID_LENGTH): string {
  return agentId.slice(0, length);
}

import { z } from 'zod';

// ── Agent Status (external/API — backward compatible) ─────────────

export const AgentStatusSchema = z.enum([
  'creating', 'running', 'idle', 'completed', 'failed', 'terminated',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// ── Agent Phase (internal state machine) ──────────────────────────

export const AgentPhaseSchema = z.enum([
  'idle',       // Ready for messages, not actively processing
  'starting',   // Being created/initialized (maps to status 'creating')
  'running',    // Actively processing a message or tool call
  'thinking',   // LLM is generating a response (sub-state of running)
  'resuming',   // In resume initialization window (replaces _resuming boolean)
  'stopping',   // Termination in progress
  'stopped',    // Terminated or completed (terminal state)
  'error',      // Failed (terminal state)
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

/** Phases considered terminal — no further work will occur */
export function isTerminalPhase(phase: AgentPhase): boolean {
  return phase === 'stopped' || phase === 'error';
}

/**
 * Valid phase transitions. Each key lists the phases it can transition TO.
 * Invalid transitions are logged as warnings but not blocked (defensive).
 */
export const PHASE_TRANSITIONS: Record<AgentPhase, ReadonlySet<AgentPhase>> = {
  starting: new Set(['running', 'resuming', 'stopping', 'stopped', 'error']),
  resuming: new Set(['idle', 'running', 'thinking', 'stopping', 'stopped', 'error']),
  idle:     new Set(['running', 'stopping', 'stopped', 'error']),
  running:  new Set(['idle', 'thinking', 'stopping', 'stopped', 'error']),
  thinking: new Set(['running', 'idle', 'stopping', 'stopped', 'error']),
  stopping: new Set(['stopped', 'error']),
  stopped:  new Set(['stopped']),  // re-entry allowed for terminate-after-completion
  error:    new Set(['stopped']),  // cleanup path only
};

/**
 * Map an AgentPhase to the backward-compatible AgentStatus for the API.
 * The `exitCode` is used to distinguish 'completed' from 'terminated'
 * when the phase is 'stopped'.
 */
export function phaseToStatus(phase: AgentPhase, exitCode: number | null): AgentStatus {
  switch (phase) {
    case 'starting':  return 'creating';
    case 'running':   return 'running';
    case 'thinking':  return 'running';
    case 'resuming':  return 'running';
    case 'idle':      return 'idle';
    case 'stopping':  return 'terminated';
    case 'stopped':   return exitCode === 0 ? 'completed' : 'terminated';
    case 'error':     return 'failed';
  }
}

// ── Crew hierarchy utilities ──────────────────────────────────────

/** Minimal shape required for hierarchy traversal */
export interface HierarchyAgent {
  id: string;
  parentId?: string | null;
}

/**
 * Collect all descendants of `leadId` by walking the parentId chain recursively.
 * Returns agents whose ancestry leads back to `leadId` (not including the lead itself).
 * Protected against circular references via a visited set.
 */
export function getCrewDescendants<T extends HierarchyAgent>(
  leadId: string,
  agents: T[],
): T[] {
  // Build parent→children index for O(n) traversal
  const childrenOf = new Map<string, T[]>();
  for (const agent of agents) {
    if (agent.parentId) {
      let list = childrenOf.get(agent.parentId);
      if (!list) {
        list = [];
        childrenOf.set(agent.parentId, list);
      }
      list.push(agent);
    }
  }

  const result: T[] = [];
  const visited = new Set<string>();
  visited.add(leadId); // never revisit the root

  function walk(parentId: string): void {
    const children = childrenOf.get(parentId);
    if (!children) return;
    for (const child of children) {
      if (visited.has(child.id)) continue; // circular reference protection
      visited.add(child.id);
      result.push(child);
      walk(child.id);
    }
  }

  walk(leadId);
  return result;
}

/**
 * Collect the lead plus all descendants — convenience wrapper for filtering
 * agents that belong to a crew rooted at `leadId`.
 */
export function getCrewMembers<T extends HierarchyAgent>(
  leadId: string,
  agents: T[],
): T[] {
  const lead = agents.find(a => a.id === leadId);
  const descendants = getCrewDescendants(leadId, agents);
  return lead ? [lead, ...descendants] : descendants;
}

/**
 * Check if `agentId` is a descendant of `leadId` (at any depth).
 */
export function isCrewDescendant<T extends HierarchyAgent>(
  agentId: string,
  leadId: string,
  agents: T[],
): boolean {
  if (agentId === leadId) return false;
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const visited = new Set<string>();
  let current = agentMap.get(agentId);
  while (current?.parentId) {
    if (current.parentId === leadId) return true;
    if (visited.has(current.parentId)) return false; // circular reference protection
    visited.add(current.parentId);
    current = agentMap.get(current.parentId);
  }
  return false;
}
