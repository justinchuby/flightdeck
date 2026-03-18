import type { WsHandlerContext, WsServerMessage, WsServerMessageOf } from './types';
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
 * Type-safe handler registration helper.
 * Narrows `WsServerMessage` to the specific event type at compile time,
 * eliminating the need for `as any` casts in the dispatch table.
 */
function on<T extends WsServerMessage['type']>(
  _type: T,
  handler: (msg: WsServerMessageOf<T>) => void,
): (msg: WsServerMessage) => void {
  return handler as (msg: WsServerMessage) => void;
}

/**
 * Build a message-type → handler lookup table.
 * Called once per hook mount; the returned Map is used for O(1) dispatch.
 */
export function createMessageDispatcher(ctx: WsHandlerContext): (msg: WsServerMessage) => void {
  const handlers: Record<string, (msg: WsServerMessage) => void> = {
    'init':                        on('init', (m) => handleInit(m, ctx)),
    'agent:spawned':               on('agent:spawned', (m) => handleAgentSpawned(m, ctx)),
    'agent:terminated':            on('agent:terminated', (m) => handleAgentTerminated(m, ctx)),
    'agent:exit':                  on('agent:exit', (m) => handleAgentExit(m, ctx)),
    'agent:status':                on('agent:status', (m) => handleAgentStatus(m, ctx)),
    'agent:sub_spawned':           on('agent:sub_spawned', (m) => handleSubSpawned(m, ctx)),
    'agent:spawn_error':           on('agent:spawn_error', (m) => handleSpawnError(m, ctx)),
    'agent:model_fallback':        on('agent:model_fallback', (m) => handleModelFallback(m, ctx)),
    'agent:session_ready':         on('agent:session_ready', (m) => handleSessionReady(m, ctx)),
    'agent:session_resume_failed': on('agent:session_resume_failed', (m) => handleSessionResumeFailed(m, ctx)),
    'agent:text':                  on('agent:text', (m) => handleAgentText(m, ctx)),
    'agent:response_start':        on('agent:response_start', (m) => handleResponseStart(m, ctx)),
    'agent:content':               on('agent:content', (m) => handleAgentContent(m, ctx)),
    'agent:thinking':              on('agent:thinking', (m) => handleAgentThinking(m, ctx)),
    'agent:plan':                  on('agent:plan', (m) => handleAgentPlan(m, ctx)),
    'agent:usage':                 on('agent:usage', (m) => handleAgentUsage(m, ctx)),
    'agent:tool_call':             on('agent:tool_call', (m) => handleToolCall(m, ctx)),
    'agent:message_sent':          on('agent:message_sent', (m) => handleMessageSent(m, ctx)),
    'group:created':               on('group:created', (m) => handleGroupCreated(m)),
    'group:message':               on('group:message', (m) => handleGroupMessage(m)),
    'group:member_added':          on('group:member_added', (m) => handleGroupMemberAdded(m)),
    'group:member_removed':        on('group:member_removed', (m) => handleGroupMemberRemoved(m)),
    'group:reaction':              on('group:reaction', (m) => handleGroupReaction(m)),
    'system:paused':               on('system:paused', (m) => handleSystemPaused(m, ctx)),
    'timer:created':               on('timer:created', (m) => handleTimerCreated(m)),
    'timer:fired':                 on('timer:fired', (m) => handleTimerFired(m)),
    'timer:cancelled':             on('timer:cancelled', (m) => handleTimerCancelled(m)),
    'lead:decision':               on('lead:decision', (m) => handleLeadDecision(m, ctx)),
    'decision:confirmed':          on('decision:confirmed', (m) => handleDecisionResolved(m, ctx)),
    'decision:rejected':           on('decision:rejected', (m) => handleDecisionResolved(m, ctx)),
    'decision:dismissed':          on('decision:dismissed', (m) => handleDecisionResolved(m, ctx)),
    'decisions:batch':             on('decisions:batch', (m) => handleDecisionsBatch(m, ctx)),
    'attention:changed':           () => handleAttentionChanged(),
  };

  return (msg: WsServerMessage) => {
    const handler = handlers[msg.type];
    if (handler) handler(msg);
  };
}
