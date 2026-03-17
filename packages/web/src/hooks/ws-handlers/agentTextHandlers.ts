import type { WsHandlerContext } from './types';
import { normalizeWsText } from './normalizeText';
import { hasUnclosedCommandBlock } from '../../utils/commandParser';

/**
 * Handlers for agent text streaming:
 * agent:text, agent:response_start, agent:content
 */

export function handleAgentText(msg: any, ctx: WsHandlerContext): void {
  const rawText = normalizeWsText(msg.text);
  const existing = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);
  const msgs = [...(existing?.messages ?? [])];
  const needsNewline = ctx.pendingNewlineRef.current.has(msg.agentId);
  if (needsNewline) ctx.pendingNewlineRef.current.delete(msg.agentId);

  // Find the last agent message, skipping over interleaved DM/group notifications.
  let appendIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const sender = m.sender ?? 'agent';
    if (sender === 'agent') {
      appendIdx = i;
      break;
    }
    if (sender === 'user' || sender === 'thinking' || m.text === '---') break;
  }

  const appendTarget = appendIdx >= 0 ? msgs[appendIdx] : null;
  const appendText = appendTarget?.text ?? '';
  const hasUnclosed = hasUnclosedCommandBlock(appendText);
  if (appendTarget && (hasUnclosed || !needsNewline)) {
    msgs[appendIdx] = { ...appendTarget, text: appendText + rawText, timestamp: appendTarget.timestamp || Date.now() };
  } else {
    msgs.push({ type: 'text', text: rawText, sender: 'agent', timestamp: Date.now() });
  }
  ctx.updateAgent(msg.agentId, { messages: msgs });
}

export function handleResponseStart(msg: any, ctx: WsHandlerContext): void {
  ctx.pendingNewlineRef.current.add(msg.agentId);
}

export function handleAgentContent(msg: any, ctx: WsHandlerContext): void {
  const existing = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);
  const msgs = [...(existing?.messages ?? [])];
  msgs.push({
    type: 'text',
    text: msg.content.text || '',
    sender: 'agent',
    timestamp: Date.now(),
    contentType: msg.content.contentType,
    mimeType: msg.content.mimeType,
    data: msg.content.data,
    uri: msg.content.uri,
  });
  ctx.updateAgent(msg.agentId, { messages: msgs });
}
