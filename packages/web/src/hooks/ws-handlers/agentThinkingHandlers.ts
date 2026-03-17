import type { WsHandlerContext } from './types';
import { normalizeWsText } from './normalizeText';
import { useMessageStore } from '../../stores/messageStore';

/**
 * Handler for agent:thinking events (reasoning/thinking blocks).
 */

export function handleAgentThinking(msg: any, _ctx: WsHandlerContext): void {
  const thinkText = normalizeWsText(msg.text);
  if (!thinkText) return;
  useMessageStore.getState().appendToThinkingMessage(msg.agentId, thinkText);
}
