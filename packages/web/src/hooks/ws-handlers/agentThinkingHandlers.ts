import type { WsHandlerContext } from './types';
import { normalizeWsText } from './normalizeText';

/**
 * Handler for agent:thinking events (reasoning/thinking blocks).
 */

export function handleAgentThinking(msg: any, ctx: WsHandlerContext): void {
  const thinkText = normalizeWsText(msg.text);
  if (!thinkText) return;

  ctx.messageStore.ensureChannel(msg.agentId);
  ctx.messageStore.appendToThinkingMessage(msg.agentId, thinkText);
}
