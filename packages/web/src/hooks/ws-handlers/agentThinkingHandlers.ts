import type { WsHandlerContext, WsServerMessageOf } from './types';
import { normalizeWsText } from './normalizeText';
import { useMessageStore } from '../../stores/messageStore';

/**
 * Handler for agent:thinking events (reasoning/thinking blocks).
 */

export function handleAgentThinking(msg: WsServerMessageOf<'agent:thinking'>, _ctx: WsHandlerContext): void {
  const thinkText = normalizeWsText(msg.text);
  if (!thinkText) return;
  useMessageStore.getState().appendToThinkingMessage(msg.agentId, thinkText);
}
