import type { WsHandlerContext, WsServerMessageOf } from './types';
import { shortAgentId } from '../../utils/agentLabel';
import { useMessageStore } from '../../stores/messageStore';

/**
 * Handler for agent:message_sent events (DM routing).
 * Shows messages in both the recipient's and sender's chat panels.
 */

export function handleMessageSent(msg: WsServerMessageOf<'agent:message_sent'>, ctx: WsHandlerContext): void {
  const toId = msg.to;
  const fromId = msg.from;
  const isFromSystem = fromId === 'system';
  const senderLabel = msg.fromRole
    ? `${msg.fromRole} (${shortAgentId(fromId ?? '')})`
    : (fromId ? shortAgentId(fromId) : '') || 'System';
  const preview = (msg.content ?? '').slice(0, 2000);
  const store = useMessageStore.getState();

  // Show in recipient's panel
  // Use 'system' sender for all agent messages — 'user' is reserved for human input.
  // This prevents agent-to-agent and agent-to-lead DMs from appearing as blue bubbles.
  if (toId && toId !== 'system') {
    store.addMessage(toId, {
      type: 'text',
      text: isFromSystem ? `⚙️ [System] ${preview}` : `📨 [From ${senderLabel}] ${preview}`,
      sender: 'system',
      timestamp: Date.now(),
    });
  }

  // Also show in sender's panel so both sides see the DM
  if (fromId && fromId !== 'system' && toId !== fromId) {
    const isBroadcast = toId === 'all';
    const recipientLabel = isBroadcast
      ? 'All'
      : (() => {
          const toAgent = ctx.getAppState().agents.find((a: any) => a.id === toId);
          return toAgent?.role?.name
            ? `${toAgent.role.name} (${shortAgentId(toId ?? '')})`
            : shortAgentId(toId ?? '');
        })();
    store.addMessage(fromId, {
      type: 'text',
      text: `📤 [To ${recipientLabel}] ${preview}`,
      sender: 'system',
      timestamp: Date.now(),
    });
  }
}
