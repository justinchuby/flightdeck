import { isTerminalStatus } from '../Agent.js';
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry, Delegation } from './types.js';
import { logger } from '../../utils/logger.js';

// ── Regex patterns ──────────────────────────────────────────────────

const AGENT_MESSAGE_REGEX = /\[\[\[\s*AGENT_MESSAGE\s*(\{.*?\})\s*\]\]\]/s;
const BROADCAST_REGEX = /\[\[\[\s*BROADCAST\s*(\{.*?\})\s*\]\]\]/s;
const CREATE_GROUP_REGEX = /\[\[\[\s*CREATE_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const ADD_TO_GROUP_REGEX = /\[\[\[\s*ADD_TO_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const REMOVE_FROM_GROUP_REGEX = /\[\[\[\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const GROUP_MESSAGE_REGEX = /\[\[\[\s*GROUP_MESSAGE\s*(\{.*?\})\s*\]\]\]/s;
const LIST_GROUPS_REGEX = /\[\[\[\s*LIST_GROUPS\s*\]\]\]/s;
const QUERY_GROUPS_REGEX = /\[\[\[\s*QUERY_GROUPS\s*\]\]\]/s;

// ── Exported: command entry list ─────────────────────────────────────

export function getCommCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: AGENT_MESSAGE_REGEX, name: 'AGENT_MSG', handler: (a, d) => handleAgentMessage(ctx, a, d) },
    { regex: BROADCAST_REGEX, name: 'BROADCAST', handler: (a, d) => handleBroadcast(ctx, a, d) },
    { regex: CREATE_GROUP_REGEX, name: 'CREATE_GROUP', handler: (a, d) => handleCreateGroup(ctx, a, d) },
    { regex: ADD_TO_GROUP_REGEX, name: 'ADD_TO_GROUP', handler: (a, d) => handleAddToGroup(ctx, a, d) },
    { regex: REMOVE_FROM_GROUP_REGEX, name: 'REMOVE_FROM_GROUP', handler: (a, d) => handleRemoveFromGroup(ctx, a, d) },
    { regex: GROUP_MESSAGE_REGEX, name: 'GROUP_MSG', handler: (a, d) => handleGroupMessage(ctx, a, d) },
    { regex: LIST_GROUPS_REGEX, name: 'LIST_GROUPS', handler: (a, _d) => handleListGroups(ctx, a) },
    { regex: QUERY_GROUPS_REGEX, name: 'QUERY_GROUPS', handler: (a, _d) => handleListGroups(ctx, a) },
  ];
}

// ── Exported: auto-group helper (called by AgentCommands after DELEGATE) ──

export function maybeAutoCreateGroup(
  ctx: CommandHandlerContext,
  lead: Agent,
  delegations: Map<string, Delegation>,
): void {
  const active = [...delegations.values()].filter(
    d => d.fromAgentId === lead.id && d.status === 'active',
  );
  if (active.length < 3) return;

  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'implement', 'create', 'build', 'fix', 'add', 'review', 'update', 'check', 'test', 'run', 'verify', 'ensure', 'handle', 'process', 'manage']);
  const getKeyword = (task: string): string | null => {
    const words = task.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    return words.find(w => w.length > 3 && !stopWords.has(w)) ?? null;
  };

  const keywordAgents = new Map<string, Set<string>>();
  for (const d of active) {
    const kw = getKeyword(d.task);
    if (!kw) continue;
    if (!keywordAgents.has(kw)) keywordAgents.set(kw, new Set());
    keywordAgents.get(kw)!.add(d.toAgentId);
  }

  for (const [keyword, agentIds] of keywordAgents) {
    if (agentIds.size < 3) continue;
    const groupName = `${keyword}-team`;
    const memberIds = [...agentIds, lead.id];

    ctx.chatGroupRegistry.create(lead.id, groupName, memberIds, lead.projectId);
    const newMembers = ctx.chatGroupRegistry.addMembers(lead.id, groupName, memberIds);

    if (newMembers.length === 0) continue;

    const names = [...agentIds].map(id => {
      const a = ctx.getAgent(id);
      return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
    }).join(', ');
    ctx.chatGroupRegistry.sendMessage(groupName, lead.id, 'system', 'system',
      `Auto-created coordination group for parallel ${keyword} work. Members: ${names}`);
    lead.sendMessage(`[System] Auto-created group "${groupName}" for ${agentIds.size} agents working on ${keyword}.`);

    for (const id of newMembers) {
      const member = ctx.getAgent(id);
      if (member && (member.status === 'running' || member.status === 'idle')) {
        member.sendMessage(`[System] You've been added to coordination group "${groupName}". Use GROUP_MESSAGE {"group": "${groupName}", "content": "..."} to communicate with your peers.`);
      }
    }
    break; // One auto-group per delegation event
  }
}

// ── Handler implementations ─────────────────────────────────────────

function handleAgentMessage(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(AGENT_MESSAGE_REGEX);
  if (!match) return;

  try {
    const msg = JSON.parse(match[1]);
    if (!msg.to || !msg.content) return;

    // Resolve "to" — could be full UUID, short ID prefix, role ID, or role name
    let targetId = msg.to;
    const allAgents = ctx.getAllAgents();
    if (!ctx.getAgent(targetId)) {
      const byPrefix = allAgents.find((a) => a.id.startsWith(msg.to) && (a.status === 'running' || a.status === 'idle'));
      if (byPrefix) {
        targetId = byPrefix.id;
      } else {
        const byRoleId = allAgents.find((a) => a.role.id === msg.to && (a.status === 'running' || a.status === 'idle'));
        if (byRoleId) {
          targetId = byRoleId.id;
        } else {
          const lower = msg.to.toLowerCase();
          const byRoleName = allAgents.find((a) =>
            a.role.name.toLowerCase() === lower && (a.status === 'running' || a.status === 'idle')
          );
          if (byRoleName) {
            targetId = byRoleName.id;
          } else {
            const partial = allAgents.find((a) =>
              (a.role.id.includes(lower) || a.role.name.toLowerCase().includes(lower)) && (a.status === 'running' || a.status === 'idle')
            );
            if (partial) targetId = partial.id;
          }
        }
      }
    }

    const targetAgent = ctx.getAgent(targetId);
    if (!targetAgent) {
      logger.warn('message', `Cannot resolve target "${msg.to}" for message from ${agent.role.name} (${agent.id.slice(0, 8)})`);
      return;
    }

    ctx.messageBus.send({
      from: agent.id,
      to: targetId,
      type: 'request',
      content: msg.content,
    });

    logger.info('message', `Agent message: ${agent.role.name} (${agent.id.slice(0, 8)}) → ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
      contentPreview: msg.content.slice(0, 80),
    });
    ctx.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: targetId,
      toRole: targetAgent.role.name,
      content: msg.content,
    });
    ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Message → ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
      toAgentId: targetId, toRole: targetAgent.role.id,
    });
  } catch (err) {
    logger.debug('command', 'Failed to parse AGENT_MESSAGE command', { error: (err as Error).message });
  }
}

function handleBroadcast(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(BROADCAST_REGEX);
  if (!match) return;

  try {
    const msg = JSON.parse(match[1]);
    if (!msg.content) return;

    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      logger.warn('message', `Broadcast from ${agent.role.name} (${agent.id.slice(0, 8)}) — no team lead found`);
      return;
    }

    const recipients = ctx.getAllAgents().filter((a) =>
      a.id !== agent.id &&
      (a.id === leadId || a.parentId === leadId) &&
      (a.status === 'running' || a.status === 'idle')
    );

    const fromLabel = `${agent.role.name} (${agent.id.slice(0, 8)})`;
    logger.info('message', `Broadcast from ${fromLabel} to ${recipients.length} agents: ${msg.content.slice(0, 80)}`);

    if (recipients.length === 0) {
      agent.sendMessage('[System] Warning: Broadcast sent to 0 agents — no other agents exist yet.');
    }

    for (const recipient of recipients) {
      recipient.sendMessage(`[Broadcast from ${fromLabel}]: ${msg.content}`);
    }

    ctx.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: 'all',
      toRole: 'Team',
      content: msg.content,
    });
    ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Broadcast to ${recipients.length} agents: ${msg.content.slice(0, 120)}`, {
      toAgentId: 'all', toRole: 'broadcast', recipientCount: recipients.length,
    });
  } catch (err) {
    logger.debug('command', 'Failed to parse BROADCAST command', { error: (err as Error).message });
  }
}

function handleCreateGroup(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(CREATE_GROUP_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
    if (!req.name || (!req.members && !req.roles) || (req.members && !Array.isArray(req.members))) {
      agent.sendMessage('[System] CREATE_GROUP requires "name" and either "members" (array of agent IDs) or "roles" (array of role names like ["developer", "designer"]).');
      return;
    }
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] Cannot create group — no lead context found.');
      return;
    }
    const resolvedIds: string[] = [];

    if (req.roles && Array.isArray(req.roles)) {
      const roleNames = req.roles.map((r: string) => r.toLowerCase());
      for (const a of ctx.getAllAgents()) {
        if ((a.parentId === leadId || a.id === leadId) && roleNames.includes(a.role.id.toLowerCase()) && !isTerminalStatus(a.status)) {
          if (!resolvedIds.includes(a.id)) resolvedIds.push(a.id);
        }
      }
    }

    for (const memberId of (req.members ?? [])) {
      const resolved = ctx.getAllAgents().find((a) =>
        (a.id === memberId || a.id.startsWith(memberId)) && (a.parentId === leadId || a.id === leadId)
      );
      if (resolved) {
        resolvedIds.push(resolved.id);
      } else {
        agent.sendMessage(`[System] Cannot resolve agent "${memberId}" for group. Use QUERY_CREW to see available agents.`);
      }
    }
    if (!resolvedIds.includes(agent.id)) {
      resolvedIds.push(agent.id);
    }
    const group = ctx.chatGroupRegistry.create(leadId, req.name, resolvedIds, agent.projectId, req.roles);
    const memberNames = group.memberIds.map((id) => {
      const a = ctx.getAgent(id);
      return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
    }).join(', ');
    agent.sendMessage(`[System] Group "${req.name}" created with ${group.memberIds.length} members: ${memberNames}.`);

    for (const memberId of group.memberIds) {
      if (memberId === agent.id) continue;
      const member = ctx.getAgent(memberId);
      if (member && (member.status === 'running' || member.status === 'idle')) {
        member.sendMessage(`[System] You've been added to group "${req.name}". Members: ${memberNames}.\nSend messages: [[[ GROUP_MESSAGE {"group": "${req.name}", "content": "your message"} ]]]`);
      }
    }

    ctx.emit('group:created', { group, leadId });
    logger.info('groups', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) created group "${req.name}" with ${group.memberIds.length} members`);
  } catch (err) { logger.debug('command', 'Failed to parse CREATE_GROUP command', { error: (err as Error).message }); }
}

function handleAddToGroup(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(ADD_TO_GROUP_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
    if (!req.group || !req.members) return;

    const existingGroup = ctx.chatGroupRegistry.findGroupForAgent(req.group, agent.id);
    let leadId: string | undefined;
    if (existingGroup) {
      leadId = existingGroup.leadId;
    } else {
      leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    }
    if (!leadId) { agent.sendMessage('[System] Cannot manage groups — no lead context found.'); return; }

    if (!existingGroup && agent.role.id !== 'lead' && agent.id !== leadId) {
      agent.sendMessage(`[System] You must be a member of "${req.group}" to add others. Ask a current member to add you first.`);
      return;
    }

    const resolvedIds = req.members.map((m: string) => {
      const found = ctx.getAllAgents().find((a) => (a.id === m || a.id.startsWith(m)) && (a.parentId === leadId || a.id === leadId));
      return found?.id;
    }).filter(Boolean) as string[];

    const added = ctx.chatGroupRegistry.addMembers(leadId, req.group, resolvedIds);
    if (added.length > 0) {
      const history = ctx.chatGroupRegistry.getMessages(req.group, leadId, 20);
      for (const memberId of added) {
        const member = ctx.getAgent(memberId);
        if (member && (member.status === 'running' || member.status === 'idle')) {
          const allMembers = ctx.chatGroupRegistry.getMembers(req.group, leadId);
          const memberNames = allMembers.map((id) => {
            const a = ctx.getAgent(id);
            return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
          }).join(', ');
          let historyText = '';
          if (history.length > 0) {
            historyText = '\nRecent messages:\n' + history.map((m) => `  [${m.fromRole} (${m.fromAgentId.slice(0, 8)})]: ${m.content}`).join('\n');
          }
          member.sendMessage(`[System] You've been added to group "${req.group}". Members: ${memberNames}.${historyText}\nSend messages: [[[ GROUP_MESSAGE {"group": "${req.group}", "content": "..."} ]]]`);
        }
      }
      const names = added.map((id) => ctx.getAgent(id)?.role.name || id.slice(0, 8)).join(', ');
      agent.sendMessage(`[System] Added ${names} to group "${req.group}".`);
    } else {
      agent.sendMessage(`[System] No new members added to "${req.group}" (already members or not found).`);
    }
  } catch (err) { logger.debug('command', 'Failed to parse ADD_TO_GROUP command', { error: (err as Error).message }); }
}

function handleRemoveFromGroup(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(REMOVE_FROM_GROUP_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) { agent.sendMessage('[System] Cannot manage groups — no lead context found.'); return; }
    if (!req.group || !req.members) return;
    const resolvedIds = req.members.map((m: string) => {
      const found = ctx.getAllAgents().find((a) => a.id === m || a.id.startsWith(m));
      return found?.id;
    }).filter(Boolean) as string[];

    const removed = ctx.chatGroupRegistry.removeMembers(leadId, req.group, resolvedIds);
    if (removed.length > 0) {
      const names = removed.map((id) => ctx.getAgent(id)?.role.name || id.slice(0, 8)).join(', ');
      agent.sendMessage(`[System] Removed ${names} from group "${req.group}".`);
    }
  } catch (err) { logger.debug('command', 'Failed to parse REMOVE_FROM_GROUP command', { error: (err as Error).message }); }
}

function handleGroupMessage(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(GROUP_MESSAGE_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
    if (!req.group || !req.content) return;

    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] Cannot send group message — no team lead found.');
      return;
    }

    const message = ctx.chatGroupRegistry.sendMessage(req.group, leadId, agent.id, agent.role.name, req.content);
    if (!message) {
      agent.sendMessage(`[System] Cannot send to group "${req.group}" — you are not a member. Use LIST_GROUPS to see your groups.`);
      return;
    }

    const members = ctx.chatGroupRegistry.getMembers(req.group, leadId);
    let delivered = 0;
    for (const memberId of members) {
      if (memberId === agent.id) continue;
      const member = ctx.getAgent(memberId);
      if (member && (member.status === 'running' || member.status === 'idle')) {
        member.sendMessage(`[Group "${req.group}" — ${agent.role.name} (${agent.id.slice(0, 8)})]: ${req.content}`);
        delivered++;
      }
    }

    agent.sendMessage(`[System] Message delivered to ${delivered} group member(s) in "${req.group}".`);
    ctx.emit('group:message', { message, groupName: req.group, leadId });
    ctx.activityLedger.log(agent.id, agent.role.id, 'group_message', `Group "${req.group}": ${req.content.slice(0, 120)}`, {
      groupName: req.group, recipientCount: delivered,
    });
    logger.info('groups', `Group message in "${req.group}": ${agent.role.name} (${agent.id.slice(0, 8)}) → ${delivered} recipients`);
  } catch (err) { logger.debug('command', 'Failed to parse GROUP_MESSAGE command', { error: (err as Error).message }); }
}

function handleListGroups(ctx: CommandHandlerContext, agent: Agent): void {
  const groups = ctx.chatGroupRegistry.getGroupsForAgent(agent.id);
  if (groups.length === 0) {
    agent.sendMessage('[System] You are not a member of any groups. Use CREATE_GROUP to create one.');
    return;
  }
  const lines = groups.map((g) => {
    const memberNames = g.memberIds.map((id) => {
      const a = ctx.getAgent(id);
      return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
    }).join(', ');
    const { messageCount, lastMessage } = ctx.chatGroupRegistry.getGroupSummary(g.name, g.leadId);
    const msgInfo = messageCount > 0
      ? `${messageCount} msgs — last: ${lastMessage}`
      : 'no messages yet';
    return `- "${g.name}" — ${g.memberIds.length} members: ${memberNames}\n  ${msgInfo}`;
  });
  agent.sendMessage(`[System] Your groups (${groups.length}):\n${lines.join('\n')}\nSend messages: [[[ GROUP_MESSAGE {"group": "name", "content": "..."} ]]]`);
}
