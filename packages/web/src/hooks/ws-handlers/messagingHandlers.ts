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

  // Show in recipient's panel
  if (toId && toId !== 'system') {
    const recipient = ctx.getAppState().agents.find((a: any) => a.id === toId);
    if (recipient) {
      const msgs = [...(recipient.messages ?? [])];
      msgs.push({
        type: 'text',
        text: isFromSystem ? `⚙️ [System] ${preview}` : `📨 [From ${senderLabel}] ${preview}`,
        sender: isFromSystem ? 'system' : 'user',
        timestamp: Date.now(),
      });
      ctx.updateAgent(toId, { messages: msgs });
    }
  }

  // Also show in sender's panel so both sides see the DM
  if (fromId && fromId !== 'system' && toId !== fromId) {
    const sender = ctx.getAppState().agents.find((a: any) => a.id === fromId);
    if (sender) {
      const isBroadcast = toId === 'all';
      const recipientLabel = isBroadcast
        ? 'All'
        : (() => {
            const toAgent = ctx.getAppState().agents.find((a: any) => a.id === toId);
            return toAgent?.role?.name
              ? `${toAgent.role.name} (${shortAgentId(toId ?? '')})`
              : shortAgentId(toId ?? '');
          })();
      const msgs = [...(sender.messages ?? [])];
      msgs.push({
        type: 'text',
        text: `📤 [To ${recipientLabel}] ${preview}`,
        sender: 'system',
        timestamp: Date.now(),
      });
      ctx.updateAgent(fromId, { messages: msgs });
    }
  }
}
