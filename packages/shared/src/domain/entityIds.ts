/**
 * Branded entity ID types for compile-time safety.
 *
 * These types prevent accidental ID mixups — e.g. passing an AgentId
 * where a ProjectId is expected. At runtime they're plain strings;
 * the brand exists only in the type system.
 *
 * Usage:
 *   const agentId = AgentId('abc-123');
 *   const projectId = ProjectId('proj-456');
 *   someFunction(agentId);    // ✅ if param typed AgentId
 *   someFunction(projectId);  // ❌ compile error
 */

// ── Brand helper ─────────────────────────────────────────────────────

declare const __brand: unique symbol;

/**
 * Generic branded string type. The Brand parameter is a unique literal
 * that makes otherwise-identical string types incompatible.
 */
export type Branded<Brand extends string> = string & {
  readonly [__brand]: Brand;
};

// ── Entity ID types ──────────────────────────────────────────────────

/** Unique identifier for an agent instance. */
export type AgentId = Branded<'AgentId'>;

/** Unique identifier for a project. */
export type ProjectId = Branded<'ProjectId'>;

/** Unique identifier for a lead session (also an AgentId of the lead). */
export type SessionId = Branded<'SessionId'>;

/** Unique identifier for a DAG task. */
export type TaskId = Branded<'TaskId'>;

/** Unique identifier for a message. */
export type MessageId = Branded<'MessageId'>;

/** Unique identifier for a delegation. */
export type DelegationId = Branded<'DelegationId'>;

/** Unique identifier for a decision. */
export type DecisionId = Branded<'DecisionId'>;

// ── Factory functions ────────────────────────────────────────────────
//
// These are zero-cost at runtime — they just cast the string.
// Use them at system boundaries where raw strings enter the domain.

/** Create a branded AgentId from a raw string. */
export function AgentId(raw: string): AgentId {
  return raw as AgentId;
}
/** @alias AgentId — `as`-prefix form for consistency with server code. */
export const asAgentId = AgentId;

/** Create a branded ProjectId from a raw string. */
export function ProjectId(raw: string): ProjectId {
  return raw as ProjectId;
}
/** @alias ProjectId */
export const asProjectId = ProjectId;

/** Create a branded SessionId from a raw string. */
export function SessionId(raw: string): SessionId {
  return raw as SessionId;
}
/** @alias SessionId */
export const asSessionId = SessionId;

/** Create a branded TaskId from a raw string. */
export function TaskId(raw: string): TaskId {
  return raw as TaskId;
}
/** @alias TaskId */
export const asTaskId = TaskId;

/** Create a branded MessageId from a raw string. */
export function MessageId(raw: string): MessageId {
  return raw as MessageId;
}
/** @alias MessageId */
export const asMessageId = MessageId;

/** Create a branded DelegationId from a raw string. */
export function DelegationId(raw: string): DelegationId {
  return raw as DelegationId;
}
/** @alias DelegationId */
export const asDelegationId = DelegationId;

/** Create a branded DecisionId from a raw string. */
export function DecisionId(raw: string): DecisionId {
  return raw as DecisionId;
}
/** @alias DecisionId */
export const asDecisionId = DecisionId;

// ── Type guards ──────────────────────────────────────────────────────

/** Check if a value is a non-empty string suitable for use as an ID. */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
