import type { MutableRefObject } from 'react';

import {
  handleAgentSpawned,
  handleAgentTerminated,
  handleAgentExit,
  handleAgentStatus,
  handleAgentSubSpawned,
  handleAgentText,
  handleAgentToolCall,
  handleAgentContent,
  handleAgentThinking,
  handleAgentPlan,
  handleAgentPermissionRequest,
  handleAgentSessionReady,
  handleAgentSessionResumeFailed,
  handleAgentMessageSent,
  handleAgentUsage,
} from './agentHandlers';

import {
  handleGroupCreated,
  handleGroupMessage,
  handleGroupMemberAdded,
  handleGroupMemberRemoved,
  handleGroupReaction,
} from './groupHandlers';

import {
  handleInit,
  handleSystemPaused,
  handleTimerCreated,
  handleTimerFired,
  handleTimerCancelled,
  handleLeadDecision,
  handleDecisionResolved,
  handleDecisionsBatch,
} from './systemHandlers';

export interface HandlerContext {
  setAgents: (agents: any[]) => void;
  addAgent: (agent: any) => void;
  updateAgent: (id: string, patch: Record<string, any>) => void;
  removeAgent: (id: string) => void;
  pendingNewlineRef: MutableRefObject<Set<string>>;
}

export type MessageHandler = (msg: any, ctx: HandlerContext) => void;

const handlerMap: Record<string, MessageHandler> = {
  'init': handleInit,
  'agent:spawned': handleAgentSpawned,
  'agent:terminated': handleAgentTerminated,
  'agent:exit': handleAgentExit,
  'agent:status': handleAgentStatus,
  'agent:sub_spawned': handleAgentSubSpawned,
  'agent:text': handleAgentText,
  'agent:tool_call': handleAgentToolCall,
  'agent:content': handleAgentContent,
  'agent:thinking': handleAgentThinking,
  'agent:plan': handleAgentPlan,
  'agent:permission_request': handleAgentPermissionRequest,
  'agent:session_ready': handleAgentSessionReady,
  'agent:session_resume_failed': handleAgentSessionResumeFailed,
  'agent:message_sent': handleAgentMessageSent,
  'agent:usage': handleAgentUsage,
  'group:created': handleGroupCreated,
  'group:message': handleGroupMessage,
  'group:member_added': handleGroupMemberAdded,
  'group:member_removed': handleGroupMemberRemoved,
  'group:reaction': handleGroupReaction,
  'system:paused': handleSystemPaused,
  'timer:created': handleTimerCreated,
  'timer:fired': handleTimerFired,
  'timer:cancelled': handleTimerCancelled,
  'lead:decision': handleLeadDecision,
  'decision:confirmed': handleDecisionResolved,
  'decision:rejected': handleDecisionResolved,
  'decision:dismissed': handleDecisionResolved,
  'decisions:batch': handleDecisionsBatch,
};

/** Create a message router that dispatches WS messages to focused handler functions. */
export function createMessageRouter(ctx: HandlerContext): (msg: any) => void {
  return (msg: any) => {
    const handler = handlerMap[msg.type];
    if (handler) handler(msg, ctx);
  };
}
