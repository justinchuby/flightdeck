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
