/**
 * Branded entity ID types for compile-time safety.
 *
 * Canonical definitions live in @flightdeck/shared (packages/shared/src/domain/entityIds.ts).
 * This file provides the same types and factory functions for use within the server
 * package, avoiding cross-package resolution issues in monorepo worktrees.
 *
 * The brand symbol is structurally identical to the one in shared — types created
 * here are assignment-compatible with the shared package's types.
 */

declare const __brand: unique symbol;

/** Generic branded string type. */
export type Branded<Brand extends string> = string & {
  readonly [__brand]: Brand;
};

// ── Entity ID types ──────────────────────────────────────────────────

export type AgentId = Branded<'AgentId'>;
export type ProjectId = Branded<'ProjectId'>;
export type SessionId = Branded<'SessionId'>;
export type TaskId = Branded<'TaskId'>;
export type MessageId = Branded<'MessageId'>;
export type DelegationId = Branded<'DelegationId'>;
export type DecisionId = Branded<'DecisionId'>;

// ── Factory functions (zero-cost casts) ──────────────────────────────

export function asAgentId(raw: string): AgentId { return raw as AgentId; }
export function asProjectId(raw: string): ProjectId { return raw as ProjectId; }
export function asSessionId(raw: string): SessionId { return raw as SessionId; }
export function asTaskId(raw: string): TaskId { return raw as TaskId; }
export function asMessageId(raw: string): MessageId { return raw as MessageId; }
export function asDelegationId(raw: string): DelegationId { return raw as DelegationId; }
export function asDecisionId(raw: string): DecisionId { return raw as DecisionId; }
