import type { WsHandlerContext } from './types';
import { shortAgentId } from '../../utils/agentLabel';

/**
 * Handler for agent:message_sent events (DM routing).
 * Shows messages in both the recipient's and sender's chat panels.
 */

export function handleMessageSent(msg: any, ctx: WsHandlerContext): void {
  const toId = msg.to;
  const fromId = msg.from;
  const isFromSystem = fromId === 'system';
  const senderLabel = msg.fromRole
    ? `${msg.fromRole} (${shortAgentId(fromId ?? '')})`
    : (fromId ? shortAgentId(fromId) : '') || 'System';
  const preview = (msg.content ?? '').slice(0, 2000);

  const ms = ctx.messageStore;

  // Show in recipient's panel
  if (toId && toId !== 'system') {
    ms.ensureChannel(toId);
    ms.addMessage(toId, {
      type: 'text',
      text: isFromSystem ? `⚙️ [System] ${preview}` : `📨 [From ${senderLabel}] ${preview}`,
      sender: isFromSystem ? 'system' : 'user',
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
    ms.ensureChannel(fromId);
    ms.addMessage(fromId, {
      type: 'text',
      text: `📤 [To ${recipientLabel}] ${preview}`,
      sender: 'system',
      timestamp: Date.now(),
    });
  }
}
