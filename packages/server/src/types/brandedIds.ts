/**
 * Branded entity ID types — re-exported from @flightdeck/shared.
 *
 * Types are imported from the canonical source in shared.
 * Factory functions (`as*`) are defined here since the shared package
 * also exports them but under different names (e.g. AgentId vs asAgentId).
 * Both conventions are valid; the server uses the `as*` prefix.
 */
export type {
  Branded, AgentId, ProjectId, SessionId, TaskId,
  MessageId, DelegationId, DecisionId,
} from '@flightdeck/shared';

// Re-import types locally for the factory function signatures
import type {
  AgentId, ProjectId, SessionId, TaskId,
  MessageId, DelegationId, DecisionId,
} from '@flightdeck/shared';

// ── Factory functions (zero-cost casts) ──────────────────────────────

export function asAgentId(raw: string): AgentId { return raw as AgentId; }
export function asProjectId(raw: string): ProjectId { return raw as ProjectId; }
export function asSessionId(raw: string): SessionId { return raw as SessionId; }
export function asTaskId(raw: string): TaskId { return raw as TaskId; }
export function asMessageId(raw: string): MessageId { return raw as MessageId; }
export function asDelegationId(raw: string): DelegationId { return raw as DelegationId; }
export function asDecisionId(raw: string): DecisionId { return raw as DecisionId; }
