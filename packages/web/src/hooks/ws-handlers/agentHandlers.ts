import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../components/Toast';
import { shouldNotify } from '../../stores/settingsStore';
import { hasUnclosedCommandBlock } from '../../utils/commandParser';
import type { HandlerContext } from './index';

export function handleAgentSpawned(msg: any, ctx: HandlerContext): void {
  ctx.addAgent(msg.agent);
}

export function handleAgentTerminated(msg: any, ctx: HandlerContext): void {
  ctx.removeAgent(msg.agentId);
}

export function handleAgentExit(msg: any, ctx: HandlerContext): void {
  const updates: Record<string, any> = {
    status: msg.code === 0 ? 'completed' : 'failed',
  };

  // Surface launch/crash error as a system message in the chat panel
  if (msg.error && msg.code !== 0) {
    const existing = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
    const msgs = [...(existing?.messages ?? [])];
    msgs.push({
      type: 'text',
      text: `❌ Failed to start: ${msg.error}`,
      sender: 'system',
      timestamp: Date.now(),
    });
    updates.messages = msgs;
  }

  ctx.updateAgent(msg.agentId, updates);
}

export function handleAgentStatus(msg: any, ctx: HandlerContext): void {
  const prev = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
  const wasIdle = prev && (prev.status === 'idle' || prev.status === 'completed');
  ctx.updateAgent(msg.agentId, { status: msg.status });
  // When agent transitions from idle back to running, it received new input.
  // Insert a separator so next agent:text creates a new bubble.
  if (msg.status === 'running' && wasIdle) {
    const existing = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
    if (existing?.messages?.length) {
      const last = existing.messages[existing.messages.length - 1];
      if (last?.sender === 'agent') {
        ctx.updateAgent(msg.agentId, {
          messages: [...existing.messages, { type: 'text', text: '---', sender: 'system' as any }],
        });
      }
    }
  }
}

export function handleAgentSubSpawned(msg: any, ctx: HandlerContext): void {
  ctx.addAgent(msg.child);
  ctx.updateAgent(msg.parentId, {
    childIds: [
      ...(useAppStore.getState().agents.find((a) => a.id === msg.parentId)?.childIds || []),
      msg.child.id,
    ],
  });
}

export function handleAgentText(msg: any, ctx: HandlerContext): void {
  const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
  const state = useAppStore.getState();
  const existing = state.agents.find((a) => a.id === msg.agentId);
  const msgs = [...(existing?.messages ?? [])];
  const needsNewline = ctx.pendingNewlineRef.current.has(msg.agentId);
  if (needsNewline) ctx.pendingNewlineRef.current.delete(msg.agentId);

  // Find the last agent message, skipping over interleaved DM/group notifications.
  // This prevents system notifications (📨, 📤, 🗣️) from fragmenting a streaming response.
  let appendIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const sender = m.sender ?? 'agent';
    if (sender === 'agent') {
      appendIdx = i;
      break;
    }
    // DM notifications (📨) have sender='user' but should not break the chain
    if (sender === 'user') {
      if (typeof m.text === 'string' && m.text.startsWith('📨')) continue;
      break;
    }
    // Separators and thinking blocks break the append chain
    if (sender === 'thinking' || m.text === '---') break;
    // System messages that are DM/group notifications are transparent — keep searching
  }

  // Fallback: if backward search broke on a non-DM boundary but there's an unclosed
  // command block in a recent agent message, append there to avoid splitting the command.
  if (appendIdx === -1) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if ((m.sender ?? 'agent') === 'agent' && hasUnclosedCommandBlock(m.text ?? '')) {
        appendIdx = i;
        break;
      }
    }
  }

  const appendTarget = appendIdx >= 0 ? msgs[appendIdx] : null;
  const appendText = appendTarget?.text ?? '';
  const hasUnclosedCommand = hasUnclosedCommandBlock(appendText);
  if (appendTarget && (!needsNewline || hasUnclosedCommand)) {
    msgs[appendIdx] = { ...appendTarget, text: appendText + rawText, timestamp: appendTarget.timestamp || Date.now() };
  } else {
    msgs.push({ type: 'text', text: rawText, sender: 'agent', timestamp: Date.now() });
  }
  ctx.updateAgent(msg.agentId, { messages: msgs });
}

export function handleAgentToolCall(msg: any, ctx: HandlerContext): void {
  ctx.pendingNewlineRef.current.add(msg.agentId);
  const state = useAppStore.getState();
  const existing = state.agents.find((a) => a.id === msg.agentId);
  const calls = existing?.toolCalls ?? [];
  const idx = calls.findIndex((tc: any) => tc.toolCallId === msg.toolCall.toolCallId);
  const updated = idx >= 0
    ? calls.map((tc: any, i: number) => (i === idx ? msg.toolCall : tc))
    : [...calls, msg.toolCall];
  ctx.updateAgent(msg.agentId, { toolCalls: updated });
}

export function handleAgentContent(msg: any, ctx: HandlerContext): void {
  const state = useAppStore.getState();
  const existing = state.agents.find((a) => a.id === msg.agentId);
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

export function handleAgentThinking(msg: any, ctx: HandlerContext): void {
  const state = useAppStore.getState();
  const existing = state.agents.find((a) => a.id === msg.agentId);
  const msgs = [...(existing?.messages ?? [])];
  const last = msgs[msgs.length - 1];
  // Append to existing thinking message or create new one
  if (last && last.sender === 'thinking') {
    msgs[msgs.length - 1] = { ...last, text: (last.text || '') + msg.text, timestamp: last.timestamp || Date.now() };
  } else {
    msgs.push({ type: 'text', text: msg.text, sender: 'thinking', timestamp: Date.now() });
  }
  ctx.updateAgent(msg.agentId, { messages: msgs });
}

export function handleAgentPlan(msg: any, ctx: HandlerContext): void {
  ctx.updateAgent(msg.agentId, { plan: msg.plan });
}

export function handleAgentPermissionRequest(msg: any, ctx: HandlerContext): void {
  ctx.updateAgent(msg.agentId, { pendingPermission: msg.request });
  // Permission requests are exceptions — gate on oversight level (AC-16.5)
  if (shouldNotify('exception')) {
    const agent = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
    const roleName = agent?.role?.name ?? msg.agentId.slice(0, 8);
    useToastStore.getState().add('info', `🛡️ Agent ${roleName} requests permission`);
  }
}

export function handleAgentSessionReady(msg: any, ctx: HandlerContext): void {
  ctx.updateAgent(msg.agentId, { sessionId: msg.sessionId });
}

export function handleAgentSessionResumeFailed(msg: any, _ctx: HandlerContext): void {
  const agent = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
  const roleName = agent?.role?.name ?? msg.agentId?.slice(0, 8) ?? 'Agent';
  const errorReason = msg.error || 'unknown error';
  useToastStore.getState().add('error',
    `⚠️ Failed to resume ${roleName} session.\n${errorReason}`
  );
}

export function handleAgentMessageSent(msg: any, ctx: HandlerContext): void {
  // Show incoming messages in the recipient agent's chat panel
  const toId = msg.to;
  const fromId = msg.from;
  const isFromSystem = fromId === 'system';
  const senderLabel = msg.fromRole
    ? `${msg.fromRole} (${(fromId ?? '').slice(0, 8)})`
    : fromId?.slice(0, 8) || 'System';
  const preview = (msg.content ?? '').slice(0, 2000);

  // Show in recipient's panel
  if (toId && toId !== 'system') {
    const state = useAppStore.getState();
    const recipient = state.agents.find((a) => a.id === toId);
    if (recipient) {
      const msgs = [...(recipient.messages ?? [])];
      msgs.push({
        type: 'text',
        text: isFromSystem ? `⚙️ [System] ${preview}` : `📨 [From ${senderLabel}] ${preview}`,
        sender: isFromSystem ? 'system' as any : 'user' as any,
        timestamp: Date.now(),
      });
      ctx.updateAgent(toId, { messages: msgs });
    }
  }

  // Also show in sender's panel so both sides see the DM
  if (fromId && fromId !== 'system' && toId !== fromId) {
    const state = useAppStore.getState();
    const sender = state.agents.find((a) => a.id === fromId);
    if (sender) {
      const isBroadcast = toId === 'all';
      const recipientLabel = isBroadcast
        ? 'All'
        : (() => {
            const toAgent = state.agents.find((a) => a.id === toId);
            return toAgent?.role?.name
              ? `${toAgent.role.name} (${(toId ?? '').slice(0, 8)})`
              : (toId ?? '').slice(0, 8);
          })();
      const msgs = [...(sender.messages ?? [])];
      msgs.push({
        type: 'text',
        text: `📤 [To ${recipientLabel}] ${preview}`,
        sender: 'system' as any,
        timestamp: Date.now(),
      });
      ctx.updateAgent(fromId, { messages: msgs });
    }
  }
}

export function handleAgentUsage(msg: any, ctx: HandlerContext): void {
  ctx.updateAgent(msg.agentId, {
    inputTokens: msg.inputTokens,
    outputTokens: msg.outputTokens,
    ...(msg.cacheReadTokens != null ? { cacheReadTokens: msg.cacheReadTokens } : {}),
    ...(msg.cacheWriteTokens != null ? { cacheWriteTokens: msg.cacheWriteTokens } : {}),
    ...(msg.contextWindowUsed != null ? { contextWindowUsed: msg.contextWindowUsed } : {}),
    ...(msg.contextWindowSize != null ? { contextWindowSize: msg.contextWindowSize } : {}),
  });
}
