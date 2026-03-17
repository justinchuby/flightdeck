import type { WsHandlerContext } from './types';
import { normalizeWsText } from './normalizeText';

/**
 * Handler for agent:thinking events (reasoning/thinking blocks).
 */

export function handleAgentThinking(msg: any, ctx: WsHandlerContext): void {
  const thinkText = normalizeWsText(msg.text);
  if (!thinkText) return;

  const existing = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);
  const msgs = [...(existing?.messages ?? [])];
  const last = msgs[msgs.length - 1];

  // Append to existing thinking message or create new one
  if (last && last.sender === 'thinking') {
    msgs[msgs.length - 1] = { ...last, text: (last.text || '') + thinkText, timestamp: last.timestamp || Date.now() };
  } else {
    msgs.push({ type: 'text', text: thinkText, sender: 'thinking', timestamp: Date.now() });
  }
  ctx.updateAgent(msg.agentId, { messages: msgs });
}
