// ── WebSocket Protocol Types ──────────────────────────────────────
// Discriminated union of all server→client and client→server messages.
// The union on the `type` field enables exhaustive switch/case handling.

import type { AgentStatus } from '../domain/agent.js';
import type { Alert } from '../domain/alert.js';
import type { FileLock } from '../domain/lock.js';

// ── Server → Client Events ───────────────────────────────────────

export interface AgentSpawnedEvent { type: 'agent:spawned'; agent: Record<string, unknown> }
export interface AgentTerminatedEvent { type: 'agent:terminated'; agentId: string }
export interface AgentExitEvent { type: 'agent:exit'; agentId: string; code: number; error?: string }
export interface AgentCrashedEvent { type: 'agent:crashed'; agentId: string }
export interface AgentAutoRestartedEvent { type: 'agent:auto_restarted'; agentId: string }
export interface AgentRestartLimitEvent { type: 'agent:restart_limit'; agentId: string }
export interface AgentStatusEvent { type: 'agent:status'; agentId: string; status: AgentStatus }
export interface AgentTextEvent { type: 'agent:text'; agentId: string; text: string }
export interface AgentContentEvent { type: 'agent:content'; agentId: string; content: { text?: string; contentType?: string; mimeType?: string; data?: string; uri?: string } }
export interface AgentThinkingEvent { type: 'agent:thinking'; agentId: string; text: string }
export interface AgentToolCallEvent { type: 'agent:tool_call'; agentId: string; toolCall: { toolCallId: string; title: string; kind: string; status: string; content?: string } }
export interface AgentResponseStartEvent { type: 'agent:response_start'; agentId: string }
export interface AgentPlanEvent { type: 'agent:plan'; agentId: string; plan: Array<{ content: string; priority: string; status: string }> }
export interface AgentSubSpawnedEvent { type: 'agent:sub_spawned'; parentId: string; child: Record<string, unknown> }
export interface AgentPermissionRequestEvent { type: 'agent:permission_request'; agentId: string; request: { id: string; agentId: string; toolName: string; arguments: Record<string, unknown>; timestamp: string } }
export interface AgentSessionReadyEvent { type: 'agent:session_ready'; agentId: string; sessionId: string }
export interface AgentMessageSentEvent { type: 'agent:message_sent'; from: string; to: string; fromRole?: string; content: string }
export interface AgentContextCompactedEvent { type: 'agent:context_compacted'; agentId: string }
export interface AgentDelegatedEvent { type: 'agent:delegated'; agentId: string }
export interface AgentCompletionReportedEvent { type: 'agent:completion_reported'; agentId: string; summary?: string }
export interface DagUpdatedEvent { type: 'dag:updated'; leadId: string }
export interface LockAcquiredEvent { type: 'lock:acquired'; agentId: string; lock?: FileLock }
export interface LockReleasedEvent { type: 'lock:released'; agentId: string; filePath?: string }
export interface LockExpiredEvent { type: 'lock:expired'; agentId: string; filePath?: string }
export interface ActivityEvent { type: 'activity'; entry: Record<string, unknown> }
export interface LeadDecisionEvent { type: 'lead:decision'; id: string; agentId: string; leadId?: string; title: string; rationale: string; needsConfirmation?: boolean; category?: string; autoApproved?: boolean; confirmedAt?: string; timestamp: string; projectId?: string }
export interface DecisionConfirmedEvent { type: 'decision:confirmed'; decision: Record<string, unknown> }
export interface DecisionRejectedEvent { type: 'decision:rejected'; decision: Record<string, unknown> }
export interface DecisionDismissedEvent { type: 'decision:dismissed'; decision: Record<string, unknown> }
export interface DecisionsBatchEvent { type: 'decisions:batch'; action: string; decisions: Array<Record<string, unknown>> }
export interface IntentAlertEvent { type: 'intent:alert'; decision: Record<string, unknown>; rule: { pattern: string; action: string; label: string } }
export interface AlertNewEvent { type: 'alert:new'; alert: Alert }
export interface GroupCreatedEvent { type: 'group:created'; name: string; leadId: string; memberIds?: string[]; createdAt?: string }
export interface GroupMessageEvent { type: 'group:message'; leadId: string; message: Record<string, unknown> }
export interface GroupMemberAddedEvent { type: 'group:member_added'; leadId: string; group: string; agentId: string }
export interface GroupMemberRemovedEvent { type: 'group:member_removed'; leadId: string; group: string; agentId: string }
export interface GroupReactionEvent { type: 'group:reaction'; leadId: string; groupName: string; messageId: string; agentId: string; emoji: string; action: 'add' | 'remove' }
export interface LeadProgressEvent { type: 'lead:progress'; leadId?: string; agentId?: string }
export interface TimerCreatedEvent { type: 'timer:created'; timer: { id: string; agentId: string; label: string } }
export interface TimerFiredEvent { type: 'timer:fired'; timer: { id: string; agentId: string; label: string; message?: string } }
export interface TimerCancelledEvent { type: 'timer:cancelled'; timer: { id: string; agentId: string; label: string } }
export interface SystemPausedEvent { type: 'system:paused'; paused: boolean }
export interface ConfigReloadedEvent { type: 'config:reloaded' }
export interface WsErrorEvent { type: 'error'; message: string }
export interface InitEvent { type: 'init'; agents: Array<Record<string, unknown>>; locks: FileLock[]; systemPaused?: boolean }
export interface AgentBufferEvent { type: 'agent:buffer'; agentId: string; data: Record<string, unknown> }

/** Discriminated union of all server→client WebSocket events */
export type WsServerMessage =
  | AgentSpawnedEvent | AgentTerminatedEvent | AgentExitEvent
  | AgentCrashedEvent | AgentAutoRestartedEvent | AgentRestartLimitEvent
  | AgentStatusEvent | AgentTextEvent | AgentContentEvent
  | AgentThinkingEvent | AgentToolCallEvent | AgentResponseStartEvent
  | AgentPlanEvent | AgentSubSpawnedEvent | AgentPermissionRequestEvent
  | AgentSessionReadyEvent | AgentMessageSentEvent | AgentContextCompactedEvent
  | AgentDelegatedEvent | AgentCompletionReportedEvent
  | DagUpdatedEvent | LockAcquiredEvent | LockReleasedEvent | LockExpiredEvent
  | ActivityEvent | LeadDecisionEvent
  | DecisionConfirmedEvent | DecisionRejectedEvent | DecisionDismissedEvent
  | DecisionsBatchEvent | IntentAlertEvent | AlertNewEvent
  | GroupCreatedEvent | GroupMessageEvent | GroupMemberAddedEvent
  | GroupMemberRemovedEvent | GroupReactionEvent | LeadProgressEvent
  | TimerCreatedEvent | TimerFiredEvent | TimerCancelledEvent
  | SystemPausedEvent | ConfigReloadedEvent | WsErrorEvent
  | InitEvent | AgentBufferEvent;

/** Narrow to a specific server message by type */
export type WsServerMessageOf<T extends WsServerMessage['type']> =
  Extract<WsServerMessage, { type: T }>;

// ── Client → Server Messages ─────────────────────────────────────

export interface SubscribeMessage { type: 'subscribe'; agentId: string }
export interface UnsubscribeMessage { type: 'unsubscribe'; agentId: string }
export interface SubscribeProjectMessage { type: 'subscribe-project'; projectId: string | null }
export interface InputMessage { type: 'input'; agentId: string; text: string }
export interface ResizeMessage { type: 'resize'; agentId: string; cols: number; rows: number }
export interface PermissionResponseMessage { type: 'permission_response'; agentId: string; approved: boolean }
export interface QueueOpenMessage { type: 'queue_open' }
export interface QueueClosedMessage { type: 'queue_closed' }

/** Discriminated union of all client→server WebSocket messages */
export type WsClientMessage =
  | SubscribeMessage | UnsubscribeMessage | SubscribeProjectMessage
  | InputMessage | ResizeMessage | PermissionResponseMessage
  | QueueOpenMessage | QueueClosedMessage;

