import type { WsHandlerContext } from './types';
import { normalizeWsText } from './normalizeText';
import { useMessageStore } from '../../stores/messageStore';

/**
 * Handlers for agent text streaming:
 * agent:text, agent:response_start, agent:content
 */

export function handleAgentText(msg: any, ctx: WsHandlerContext): void {
  const rawText = normalizeWsText(msg.text);
  const store = useMessageStore.getState();
  const needsNewline = ctx.pendingNewlineRef.current.has(msg.agentId);
  if (needsNewline) {
    ctx.pendingNewlineRef.current.delete(msg.agentId);
    store.setPendingNewline(msg.agentId, true);
  }
  store.appendToLastAgentMessage(msg.agentId, rawText);
}

export function handleResponseStart(msg: any, ctx: WsHandlerContext): void {
  ctx.pendingNewlineRef.current.add(msg.agentId);
}

export function handleAgentContent(msg: any, _ctx: WsHandlerContext): void {
  useMessageStore.getState().addMessage(msg.agentId, {
    type: 'text',
    text: msg.content.text || '',
    sender: 'agent',
    timestamp: Date.now(),
    contentType: msg.content.contentType,
    mimeType: msg.content.mimeType,
    data: msg.content.data,
    uri: msg.content.uri,
  });
}
