import type { WsHandlerContext, WsServerMessageOf } from './types';
import { useMessageStore } from '../../stores/messageStore';

/**
 * Handler for agent:tool_call events.
 * Manages both the live toolCalls[] array and the chronological messages[] timeline.
 */

export function handleToolCall(msg: WsServerMessageOf<'agent:tool_call'>, ctx: WsHandlerContext): void {
  ctx.pendingNewlineRef.current.add(msg.agentId);
  const existing = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);

  // Update toolCalls[] (live state)
  const calls = existing?.toolCalls ?? [];
  const idx = calls.findIndex((tc: any) => tc.toolCallId === msg.toolCall.toolCallId);
  const updated = idx >= 0
    ? calls.map((tc: any, i: number) => (i === idx ? msg.toolCall : tc))
    : [...calls, msg.toolCall];

  // Append to messages[] (timeline) — only on status transitions
  const tc = msg.toolCall;
  const prevTc = idx >= 0 ? calls[idx] : undefined;
  if (!prevTc || prevTc.status !== tc.status) {
    const store = useMessageStore.getState();
    const channel = store.channels[msg.agentId];
    const msgs = [...(channel?.messages ?? [])];
    const statusIcon = tc.status === 'completed' ? '✓' : tc.status === 'cancelled' ? '✗' : '⟳';
    const title = typeof tc.title === 'string' ? tc.title : String(tc.title);

    // Find existing message with same toolCallId and update in-place
    const existingMsgIdx = msgs.findIndex(
      (m: any) => m.sender === 'tool' && m.toolCallId === tc.toolCallId,
    );

    if (existingMsgIdx >= 0) {
      msgs[existingMsgIdx] = {
        ...msgs[existingMsgIdx],
        text: `${statusIcon} ${title}`,
        toolStatus: tc.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
      };
    } else {
      msgs.push({
        type: 'text',
        text: `${statusIcon} ${title}`,
        sender: 'tool',
        timestamp: Date.now(),
        toolCallId: tc.toolCallId,
        toolStatus: tc.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
        toolKind: tc.kind,
      });
    }
    store.setMessages(msg.agentId, msgs);
    ctx.updateAgent(msg.agentId, { toolCalls: updated });
  } else {
    ctx.updateAgent(msg.agentId, { toolCalls: updated });
  }
}
