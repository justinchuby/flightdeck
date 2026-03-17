import type { WsServerMessageOf } from './types';
import { useGroupStore, groupKey } from '../../stores/groupStore';

/**
 * Handlers for group chat events:
 * group:created, group:message, group:member_added, group:member_removed, group:reaction
 */

export function handleGroupCreated(msg: WsServerMessageOf<'group:created'>): void {
  const gs = useGroupStore.getState();
  gs.addGroup({
    name: msg.name,
    leadId: msg.leadId,
    memberIds: msg.memberIds ?? [],
    createdAt: msg.createdAt ?? new Date().toISOString(),
  });
}

export function handleGroupMessage(msg: WsServerMessageOf<'group:message'>): void {
  const gs = useGroupStore.getState();
  if (msg.message) {
    const message = msg.message as { leadId: string; groupName: string };
    const key = groupKey(message.leadId, message.groupName);
    gs.addMessage(key, msg.message as any);
  }
}

export function handleGroupMemberAdded(msg: WsServerMessageOf<'group:member_added'>): void {
  const gs = useGroupStore.getState();
  if (msg.group && msg.agentId) {
    gs.addMember(msg.leadId, msg.group, msg.agentId);
  }
}

export function handleGroupMemberRemoved(msg: WsServerMessageOf<'group:member_removed'>): void {
  const gs = useGroupStore.getState();
  if (msg.group && msg.agentId) {
    gs.removeMember(msg.leadId, msg.group, msg.agentId);
  }
}

export function handleGroupReaction(msg: WsServerMessageOf<'group:reaction'>): void {
  const gs = useGroupStore.getState();
  if (msg.messageId && msg.emoji && msg.agentId) {
    const key = groupKey(msg.leadId, msg.groupName);
    if (msg.action === 'remove') {
      gs.removeReaction(key, msg.messageId, msg.emoji, msg.agentId);
    } else {
      gs.addReaction(key, msg.messageId, msg.emoji, msg.agentId);
    }
  }
}
