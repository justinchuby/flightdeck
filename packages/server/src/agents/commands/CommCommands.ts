import { isTerminalStatus } from '../Agent.js';
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry, Delegation } from './types.js';
import { logger } from '../../utils/logger.js';
import { deriveArgs } from './CommandHelp.js';
import {
  parseCommandPayload,
  agentMessageSchema,
  interruptSchema,
  broadcastSchema,
  createGroupSchema,
  addToGroupSchema,
  removeFromGroupSchema,
  groupMessageSchema,
  reactSchema,
} from './commandSchemas.js';

// ── Regex patterns ──────────────────────────────────────────────────

const AGENT_MESSAGE_REGEX = /⟦⟦\s*AGENT_MESSAGE\s*(\{.*?\})\s*⟧⟧/s;
const BROADCAST_REGEX = /⟦⟦\s*BROADCAST\s*(\{.*?\})\s*⟧⟧/s;
const CREATE_GROUP_REGEX = /⟦⟦\s*CREATE_GROUP\s*(\{.*?\})\s*⟧⟧/s;
const ADD_TO_GROUP_REGEX = /⟦⟦\s*ADD_TO_GROUP\s*(\{.*?\})\s*⟧⟧/s;
const REMOVE_FROM_GROUP_REGEX = /⟦⟦\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*⟧⟧/s;
const GROUP_MESSAGE_REGEX = /⟦⟦\s*GROUP_MESSAGE\s*(\{.*?\})\s*⟧⟧/s;
const LIST_GROUPS_REGEX = /⟦⟦\s*LIST_GROUPS\s*⟧⟧/s;
const QUERY_GROUPS_REGEX = /⟦⟦\s*QUERY_GROUPS\s*⟧⟧/s;
const INTERRUPT_REGEX = /⟦⟦\s*INTERRUPT\s*(\{.*?\})\s*⟧⟧/s;
const REACT_REGEX = /⟦⟦\s*REACT\s*(\{.*?\})\s*⟧⟧/s;
const TELEGRAM_REPLY_REGEX = /⟦⟦\s*TELEGRAM_REPLY\s*(\{.*?\})\s*⟧⟧/s;

// ── Exported: command entry list ─────────────────────────────────────

export function getCommCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: AGENT_MESSAGE_REGEX, name: 'AGENT_MESSAGE', handler: (a, d) => handleAgentMessage(ctx, a, d), help: { description: 'Send a message to an agent', example: 'AGENT_MESSAGE {"to": "agent-id-or-role", "content": "your message"}', category: 'Communication', args: deriveArgs(agentMessageSchema) } },
    { regex: BROADCAST_REGEX, name: 'BROADCAST', handler: (a, d) => handleBroadcast(ctx, a, d), help: { description: 'Send a message to all agents', example: 'BROADCAST {"content": "attention everyone..."}', category: 'Communication', args: deriveArgs(broadcastSchema) } },
    { regex: CREATE_GROUP_REGEX, name: 'CREATE_GROUP', handler: (a, d) => handleCreateGroup(ctx, a, d), help: { description: 'Create a chat group', example: 'CREATE_GROUP {"name": "backend-team", "members": ["id1", "id2"]}', category: 'Groups', args: deriveArgs(createGroupSchema) } },
    { regex: ADD_TO_GROUP_REGEX, name: 'ADD_TO_GROUP', handler: (a, d) => handleAddToGroup(ctx, a, d), help: { description: 'Add members to a group', example: 'ADD_TO_GROUP {"group": "backend-team", "members": ["id3"]}', category: 'Groups', args: deriveArgs(addToGroupSchema) } },
    { regex: REMOVE_FROM_GROUP_REGEX, name: 'REMOVE_FROM_GROUP', handler: (a, d) => handleRemoveFromGroup(ctx, a, d), help: { description: 'Remove members from a group', example: 'REMOVE_FROM_GROUP {"group": "backend-team", "members": ["id2"]}', category: 'Groups', args: deriveArgs(removeFromGroupSchema) } },
    { regex: GROUP_MESSAGE_REGEX, name: 'GROUP_MESSAGE', handler: (a, d) => handleGroupMessage(ctx, a, d), help: { description: 'Send a message to a group', example: 'GROUP_MESSAGE {"group": "backend-team", "content": "sync up"}', category: 'Groups', args: deriveArgs(groupMessageSchema) } },
    { regex: LIST_GROUPS_REGEX, name: 'LIST_GROUPS', handler: (a, _d) => handleListGroups(ctx, a) },
    { regex: QUERY_GROUPS_REGEX, name: 'QUERY_GROUPS', handler: (a, _d) => handleListGroups(ctx, a), help: { description: 'List all groups you belong to', example: 'QUERY_GROUPS {}', category: 'Groups' } },
    { regex: INTERRUPT_REGEX, name: 'INTERRUPT', handler: (a, d) => handleInterrupt(ctx, a, d), help: { description: 'Interrupt an agent with an urgent message', example: 'INTERRUPT {"to": "agent-id", "content": "urgent: stop current work"}', category: 'Communication', args: deriveArgs(interruptSchema) } },
    { regex: REACT_REGEX, name: 'REACT', handler: (a, d) => handleReact(ctx, a, d) },
    { regex: TELEGRAM_REPLY_REGEX, name: 'TELEGRAM_REPLY', handler: (a, d) => handleTelegramReply(ctx, a, d), help: { description: 'Reply to a Telegram message', example: 'TELEGRAM_REPLY {"messageId": "12345", "content": "response text"}', category: 'Communication' } },
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

// ── Shared agent resolution with integrated project boundary check ──

/**
 * Resolve a target agent by ID, prefix, role ID, or role name — scoped to the
 * sender's project. The project check is applied at EVERY resolution step
 * (including exact UUID matches) so there is no code path that bypasses it.
 *
 * This replaces the previous two-step approach (resolve, then boundary check)
 * which failed at runtime when senderProjectId was undefined.
 */
export function resolveAgentInProject(
  ctx: CommandHandlerContext,
  to: string,
  senderProjectId: string | undefined,
): Agent | undefined {
  const isInSameProject = (a: Agent) =>
    !senderProjectId || ctx.getProjectIdForAgent(a.id) === senderProjectId;
  const isActive = (a: Agent) => a.status === 'running' || a.status === 'idle';

  // 1. Exact UUID match — must be in same project
  const exactMatch = ctx.getAgent(to);
  if (exactMatch && isInSameProject(exactMatch)) {
    return exactMatch;
  }

  // 2. Build candidate list: active, same-project agents
  const candidates = ctx.getAllAgents().filter((a) => isInSameProject(a) && isActive(a));

  // 3. ID prefix match
  const byPrefix = candidates.find((a) => a.id.startsWith(to));
  if (byPrefix) return byPrefix;

  // 4. Role ID match
  const byRoleId = candidates.find((a) => a.role.id === to);
  if (byRoleId) return byRoleId;

  // 5. Role name match (case-insensitive)
  const lower = to.toLowerCase();
  const byRoleName = candidates.find((a) => a.role.name.toLowerCase() === lower);
  if (byRoleName) return byRoleName;

  // 6. Partial match (role ID or name contains the search term)
  const partial = candidates.find((a) =>
    a.role.id.includes(lower) || a.role.name.toLowerCase().includes(lower),
  );
  return partial;
}

// ── Handler implementations ─────────────────────────────────────────

function handleAgentMessage(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(AGENT_MESSAGE_REGEX);
  if (!match) return;

  try {
    const msg = parseCommandPayload(agent, match[1], agentMessageSchema, 'AGENT_MESSAGE');
    if (!msg) return;

    const senderProjectId = ctx.getProjectIdForAgent(agent.id);
    const targetAgent = resolveAgentInProject(ctx, msg.to, senderProjectId);

    if (!targetAgent) {
      logger.warn({ module: 'comms', msg: 'Cannot resolve message target', targetRef: msg.to });
      agent.sendMessage(`[System] Agent "${msg.to}" not found. Use QUERY_CREW to see available agents.`);
      return;
    }

    const targetId = targetAgent.id;
    ctx.messageBus.send({
      from: agent.id,
      to: targetId,
      type: 'request',
      content: msg.content,
    });

    logger.info({ module: 'comms', msg: 'Agent message sent', targetAgentId: targetId, targetRole: targetAgent.role.name, contentPreview: msg.content.slice(0, 80) });
    ctx.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: targetId,
      toRole: targetAgent.role.name,
      content: msg.content,
    });
    ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Message → ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
      toAgentId: targetId, toRole: targetAgent.role.id,
    }, ctx.getProjectIdForAgent(agent.id) ?? '');
  } catch (err) {
    logger.debug({ module: 'command', msg: 'Parse failed', command: 'AGENT_MESSAGE', err: (err as Error).message });
  }
}

function handleBroadcast(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(BROADCAST_REGEX);
  if (!match) return;

  try {
    const msg = parseCommandPayload(agent, match[1], broadcastSchema, 'BROADCAST');
    if (!msg) return;

    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      logger.warn({ module: 'comms', msg: 'Broadcast failed — no team lead found' });
      return;
    }

    // Exclude the lead — they see broadcasts via WebSocket events in the comms panel.
    // Injecting into the lead's ACP prompt causes redundant reactions that clutter user chat.
    const recipients = ctx.getAllAgents().filter((a) =>
      a.id !== agent.id &&
      a.id !== leadId &&
      a.parentId === leadId &&
      (a.status === 'running' || a.status === 'idle')
    );

    logger.info({ module: 'comms', msg: 'Broadcast sent', recipientCount: recipients.length, contentPreview: msg.content.slice(0, 80) });

    const fromLabel = `${agent.role.name} (${agent.id.slice(0, 8)})`;
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
    }, ctx.getProjectIdForAgent(agent.id) ?? '');
  } catch (err) {
    logger.debug({ module: 'command', msg: 'Parse failed', command: 'BROADCAST', err: (err as Error).message });
  }
}

function handleCreateGroup(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(CREATE_GROUP_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], createGroupSchema, 'CREATE_GROUP');
    if (!req) return;
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
    const memberNames = group.memberIds.map((id: string) => {
      const a = ctx.getAgent(id);
      return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
    }).join(', ');
    agent.sendMessage(`[System] Group "${req.name}" created with ${group.memberIds.length} members: ${memberNames}.`);

    for (const memberId of group.memberIds) {
      if (memberId === agent.id) continue;
      const member = ctx.getAgent(memberId);
      if (member && (member.status === 'running' || member.status === 'idle')) {
        member.sendMessage(`[System] You've been added to group "${req.name}". Members: ${memberNames}.\nSend messages: ⟦⟦ GROUP_MESSAGE {"group": "${req.name}", "content": "your message"} ⟧⟧`);
      }
    }

    ctx.emit('group:created', { group, leadId });
    logger.info({ module: 'comms', msg: 'Group created', groupName: req.name, memberCount: group.memberIds.length });
  } catch (err) { logger.debug({ module: 'command', msg: 'Parse failed', command: 'CREATE_GROUP', err: (err as Error).message }); }
}

function handleAddToGroup(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(ADD_TO_GROUP_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], addToGroupSchema, 'ADD_TO_GROUP');
    if (!req) return;

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
          member.sendMessage(`[System] You've been added to group "${req.group}". Members: ${memberNames}.${historyText}\nSend messages: ⟦⟦ GROUP_MESSAGE {"group": "${req.group}", "content": "..."} ⟧⟧`);
        }
      }
      const names = added.map((id) => ctx.getAgent(id)?.role.name || id.slice(0, 8)).join(', ');
      agent.sendMessage(`[System] Added ${names} to group "${req.group}".`);
    } else {
      agent.sendMessage(`[System] No new members added to "${req.group}" (already members or not found).`);
    }
  } catch (err) { logger.debug({ module: 'command', msg: 'Parse failed', command: 'ADD_TO_GROUP', err: (err as Error).message }); }
}

function handleRemoveFromGroup(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(REMOVE_FROM_GROUP_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], removeFromGroupSchema, 'REMOVE_FROM_GROUP');
    if (!req) return;
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) { agent.sendMessage('[System] Cannot manage groups — no lead context found.'); return; }
    const senderProjectId = ctx.getProjectIdForAgent(agent.id);
    const resolvedIds = req.members.map((m: string) => {
      const resolved = resolveAgentInProject(ctx, m, senderProjectId);
      return resolved?.id;
    }).filter(Boolean) as string[];

    const removed = ctx.chatGroupRegistry.removeMembers(leadId, req.group, resolvedIds);
    if (removed.length > 0) {
      const names = removed.map((id) => ctx.getAgent(id)?.role.name || id.slice(0, 8)).join(', ');
      agent.sendMessage(`[System] Removed ${names} from group "${req.group}".`);
    }
  } catch (err) { logger.debug({ module: 'command', msg: 'Parse failed', command: 'REMOVE_FROM_GROUP', err: (err as Error).message }); }
}

function handleGroupMessage(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(GROUP_MESSAGE_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], groupMessageSchema, 'GROUP_MESSAGE');
    if (!req) return;

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
    }, ctx.getProjectIdForAgent(agent.id) ?? '');
    logger.info({ module: 'comms', msg: 'Group message sent', groupName: req.group, recipientCount: delivered });
  } catch (err) { logger.debug({ module: 'command', msg: 'Parse failed', command: 'GROUP_MESSAGE', err: (err as Error).message }); }
}

function handleListGroups(ctx: CommandHandlerContext, agent: Agent): void {
  const groups = ctx.chatGroupRegistry.getGroupsForAgent(agent.id);
  if (groups.length === 0) {
    agent.sendMessage('[System] You are not a member of any groups. Use CREATE_GROUP to create one.');
    return;
  }
  const lines = groups.map((g) => {
    const memberNames = g.memberIds.map((id: string) => {
      const a = ctx.getAgent(id);
      return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
    }).join(', ');
    const { messageCount, lastMessage } = ctx.chatGroupRegistry.getGroupSummary(g.name, g.leadId);
    const msgInfo = messageCount > 0
      ? `${messageCount} msgs — last: ${lastMessage}`
      : 'no messages yet';
    return `- "${g.name}" — ${g.memberIds.length} members: ${memberNames}\n  ${msgInfo}`;
  });
  agent.sendMessage(`[System] Your groups (${groups.length}):\n${lines.join('\n')}\nSend messages: ⟦⟦ GROUP_MESSAGE {"group": "name", "content": "..."} ⟧⟧`);
}

// ── INTERRUPT handler ───────────────────────────────────────────────

async function handleInterrupt(ctx: CommandHandlerContext, agent: Agent, data: string): Promise<void> {
  const match = data.match(INTERRUPT_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], interruptSchema, 'INTERRUPT');
    if (!req) return;

    // Resolve target agent — uses same project-scoped resolution as AGENT_MESSAGE
    const senderProjectId = ctx.getProjectIdForAgent(agent.id);
    const target = resolveAgentInProject(ctx, req.to, senderProjectId);
    if (!target) {
      agent.sendMessage(`[System] Cannot resolve agent "${req.to}" for interrupt.`);
      return;
    }

    // Cannot interrupt yourself
    if (target.id === agent.id) {
      agent.sendMessage('[System] Cannot interrupt yourself.');
      return;
    }

    // Only parent agents can interrupt their children
    if (target.parentId !== agent.id) {
      agent.sendMessage(`[System] Cannot interrupt ${target.role.name} (${target.id.slice(0, 8)}) — you are not their parent agent.`);
      return;
    }

    // Cannot interrupt a terminated agent
    if (isTerminalStatus(target.status)) {
      agent.sendMessage(`[System] Cannot interrupt ${target.role.name} (${target.id.slice(0, 8)}) — agent is ${target.status}.`);
      return;
    }

    const formatted = `[PRIORITY — Interrupt from ${agent.role.name} (${agent.id.slice(0, 8)})]\n${req.content}\n\nThis message interrupted your current work. Address it immediately.`;
    await target.interruptWithMessage(formatted);

    agent.sendMessage(`[System] Interrupted ${target.role.name} (${target.id.slice(0, 8)}). New instructions delivered.`);

    ctx.activityLedger.log(agent.id, agent.role.id, 'agent_interrupted',
      `Interrupted ${target.role.name} (${target.id.slice(0, 8)}): ${req.content.slice(0, 120)}`,
      { toAgentId: target.id, toRole: target.role.id },
      ctx.getProjectIdForAgent(agent.id) ?? '');

    ctx.emit('agent:interrupted', { from: agent.id, to: target.id, content: req.content });
  } catch (err) {
    logger.debug({ module: 'command', msg: 'Parse failed', command: 'INTERRUPT', err: (err as Error).message });
  }
}

// ── REACT handler ───────────────────────────────────────────────────

function handleReact(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(REACT_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], reactSchema, 'REACT');
    if (!req) return;

    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] Cannot react — no team lead found.');
      return;
    }

    // Resolve messageId — if omitted, react to the latest message in the group
    let messageId = req.messageId;
    if (!messageId) {
      const messages = ctx.chatGroupRegistry.getMessages(req.group, leadId, 1);
      if (messages.length === 0) {
        agent.sendMessage(`[System] Cannot react — no messages in group "${req.group}".`);
        return;
      }
      messageId = messages[0].id;
    }

    const success = ctx.chatGroupRegistry.addReaction(messageId!, agent.id, req.emoji);
    if (success) {
      logger.info({ module: 'comms', msg: 'Reaction added', groupName: req.group, emoji: req.emoji, messageId });
    } else {
      agent.sendMessage(`[System] Could not add reaction — message not found or already reacted.`);
    }
  } catch (err) {
    logger.debug({ module: 'command', msg: 'Parse failed', command: 'REACT', err: (err as Error).message });
  }
}

// ── TELEGRAM_REPLY ──────────────────────────────────────────────────

function handleTelegramReply(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  try {
    const parsed = JSON.parse(data);
    const messageId = parsed.messageId ?? parsed.message_id;
    const content = parsed.content ?? parsed.text;

    if (!messageId || !content) {
      agent.sendMessage('[System] TELEGRAM_REPLY requires "messageId" and "content" fields.');
      return;
    }

    if (!ctx.integrationRouter) {
      agent.sendMessage('[System] Telegram integration is not configured.');
      return;
    }

    const sent = ctx.integrationRouter.sendReply(String(messageId), String(content));
    if (sent) {
      logger.info({ module: 'comms', msg: 'Telegram reply sent', messageId, agentId: agent.id });
    } else {
      agent.sendMessage(`[System] No pending Telegram message with ID ${messageId}. The message may have expired (30-min TTL).`);
    }
  } catch (err) {
    logger.debug({ module: 'command', msg: 'Parse failed', command: 'TELEGRAM_REPLY', err: (err as Error).message });
  }
}
