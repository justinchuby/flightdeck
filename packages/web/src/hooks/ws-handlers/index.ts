import type { WsHandlerContext, WsServerMessage } from './types';
import {
  handleInit, handleAgentSpawned, handleAgentTerminated, handleAgentExit,
  handleAgentStatus, handleSubSpawned, handleSpawnError, handleModelFallback,
  handleSessionReady, handleSessionResumeFailed,
} from './agentStatusHandlers';
import { handleAgentText, handleResponseStart, handleAgentContent } from './agentTextHandlers';
import { handleAgentThinking } from './agentThinkingHandlers';
import { handleAgentPlan, handleAgentUsage } from './agentDataHandlers';
import { handleToolCall } from './toolCallHandlers';
import { handleMessageSent } from './messagingHandlers';
import {
  handleGroupCreated, handleGroupMessage, handleGroupMemberAdded,
  handleGroupMemberRemoved, handleGroupReaction,
} from './groupHandlers';
import {
  handleSystemPaused, handleTimerCreated, handleTimerFired, handleTimerCancelled,
  handleLeadDecision, handleDecisionResolved, handleDecisionsBatch, handleAttentionChanged,
} from './systemHandlers';

export type { WsHandlerContext } from './types';
export { normalizeWsText } from './normalizeText';

/**
 * Build a message-type → handler lookup table.
 * Called once per hook mount; the returned Map is used for O(1) dispatch.
 */
export function createMessageDispatcher(ctx: WsHandlerContext): (msg: WsServerMessage) => void {
  // Each handler is typed to its specific event interface via WsServerMessageOf<T>.
  // The dispatcher narrows the union by `msg.type` at runtime for O(1) lookup.
  const handlers: Record<string, (msg: WsServerMessage) => void> = {
    'init':                       (m) => handleInit(m as any, ctx),
    'agent:spawned':              (m) => handleAgentSpawned(m as any, ctx),
    'agent:terminated':           (m) => handleAgentTerminated(m as any, ctx),
    'agent:exit':                 (m) => handleAgentExit(m as any, ctx),
    'agent:status':               (m) => handleAgentStatus(m as any, ctx),
    'agent:sub_spawned':          (m) => handleSubSpawned(m as any, ctx),
    'agent:spawn_error':          (m) => handleSpawnError(m as any, ctx),
    'agent:model_fallback':       (m) => handleModelFallback(m as any, ctx),
    'agent:session_ready':        (m) => handleSessionReady(m as any, ctx),
    'agent:session_resume_failed': (m) => handleSessionResumeFailed(m as any, ctx),
    'agent:text':                 (m) => handleAgentText(m as any, ctx),
    'agent:response_start':       (m) => handleResponseStart(m as any, ctx),
    'agent:content':              (m) => handleAgentContent(m as any, ctx),
    'agent:thinking':             (m) => handleAgentThinking(m as any, ctx),
    'agent:plan':                 (m) => handleAgentPlan(m as any, ctx),
    'agent:usage':                (m) => handleAgentUsage(m as any, ctx),
    'agent:tool_call':            (m) => handleToolCall(m as any, ctx),
    'agent:message_sent':         (m) => handleMessageSent(m as any, ctx),
    'group:created':              (m) => handleGroupCreated(m as any),
    'group:message':              (m) => handleGroupMessage(m as any),
    'group:member_added':         (m) => handleGroupMemberAdded(m as any),
    'group:member_removed':       (m) => handleGroupMemberRemoved(m as any),
    'group:reaction':             (m) => handleGroupReaction(m as any),
    'system:paused':              (m) => handleSystemPaused(m as any, ctx),
    'timer:created':              (m) => handleTimerCreated(m as any),
    'timer:fired':                (m) => handleTimerFired(m as any),
    'timer:cancelled':            (m) => handleTimerCancelled(m as any),
    'lead:decision':              (m) => handleLeadDecision(m as any, ctx),
    'decision:confirmed':         (m) => handleDecisionResolved(m as any, ctx),
    'decision:rejected':          (m) => handleDecisionResolved(m as any, ctx),
    'decision:dismissed':         (m) => handleDecisionResolved(m as any, ctx),
    'decisions:batch':            (m) => handleDecisionsBatch(m as any, ctx),
    'attention:changed':          () => handleAttentionChanged(),
  };

  return (msg: WsServerMessage) => {
    const handler = handlers[msg.type];
    if (handler) handler(msg);
  };
}
