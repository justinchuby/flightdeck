import type { WsHandlerContext } from './types';
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
export function createMessageDispatcher(ctx: WsHandlerContext): (msg: any) => void {
  const handlers: Record<string, (msg: any) => void> = {
    'init':                       (m) => handleInit(m, ctx),
    'agent:spawned':              (m) => handleAgentSpawned(m, ctx),
    'agent:terminated':           (m) => handleAgentTerminated(m, ctx),
    'agent:exit':                 (m) => handleAgentExit(m, ctx),
    'agent:status':               (m) => handleAgentStatus(m, ctx),
    'agent:sub_spawned':          (m) => handleSubSpawned(m, ctx),
    'agent:spawn_error':          (m) => handleSpawnError(m, ctx),
    'agent:model_fallback':       (m) => handleModelFallback(m, ctx),
    'agent:session_ready':        (m) => handleSessionReady(m, ctx),
    'agent:session_resume_failed': (m) => handleSessionResumeFailed(m, ctx),
    'agent:text':                 (m) => handleAgentText(m, ctx),
    'agent:response_start':       (m) => handleResponseStart(m, ctx),
    'agent:content':              (m) => handleAgentContent(m, ctx),
    'agent:thinking':             (m) => handleAgentThinking(m, ctx),
    'agent:plan':                 (m) => handleAgentPlan(m, ctx),
    'agent:usage':                (m) => handleAgentUsage(m, ctx),
    'agent:tool_call':            (m) => handleToolCall(m, ctx),
    'agent:message_sent':         (m) => handleMessageSent(m, ctx),
    'group:created':              (m) => handleGroupCreated(m),
    'group:message':              (m) => handleGroupMessage(m),
    'group:member_added':         (m) => handleGroupMemberAdded(m),
    'group:member_removed':       (m) => handleGroupMemberRemoved(m),
    'group:reaction':             (m) => handleGroupReaction(m),
    'system:paused':              (m) => handleSystemPaused(m, ctx),
    'timer:created':              (m) => handleTimerCreated(m),
    'timer:fired':                (m) => handleTimerFired(m),
    'timer:cancelled':            (m) => handleTimerCancelled(m),
    'lead:decision':              (m) => handleLeadDecision(m, ctx),
    'decision:confirmed':         (m) => handleDecisionResolved(m, ctx),
    'decision:rejected':          (m) => handleDecisionResolved(m, ctx),
    'decision:dismissed':         (m) => handleDecisionResolved(m, ctx),
    'decisions:batch':            (m) => handleDecisionsBatch(m, ctx),
    'attention:changed':          () => handleAttentionChanged(),
  };

  return (msg: any) => {
    const handler = handlers[msg.type];
    if (handler) handler(msg);
  };
}
