/**
 * DirectMessageCommands — Peer-to-peer agent messaging.
 *
 * Provides two commands:
 *   DIRECT_MESSAGE — send a message directly to another agent without lead relay
 *   QUERY_PEERS    — list sibling agents under the same lead
 *
 * This reduces lead context token usage and latency for agent-to-agent coordination.
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { isTerminalStatus } from '../Agent.js';
import { parseCommandPayload, directMessageSchema } from './commandSchemas.js';

const DM_REGEX = /⟦⟦\s*DIRECT_MESSAGE\s*(\{.*?\})\s*⟧⟧/s;
const QUERY_PEERS_REGEX = /⟦⟦\s*QUERY_PEERS\s*⟧⟧/s;

function handleDirectMessage(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(DM_REGEX);
  if (!match) return;

  try {
    const payload = parseCommandPayload(agent, match[1], directMessageSchema, 'DIRECT_MESSAGE');
    if (!payload) return;
    const { to, content } = payload;

    // Resolve target: exact ID first, then short prefix match
    // Scope to sender's project to prevent cross-project messaging
    const senderProjectId = ctx.getProjectIdForAgent(agent.id);
    const isInSameProject = (a: Agent) =>
      !senderProjectId || ctx.getProjectIdForAgent(a.id) === senderProjectId;

    const exactMatch = ctx.getAgent(to);
    const target = (exactMatch && isInSameProject(exactMatch))
      ? exactMatch
      : ctx.getAllAgents().find((a) => a.id.startsWith(to) && isInSameProject(a));

    if (!target) {
      agent.sendMessage(`[System] Agent "${to}" not found. Use QUERY_PEERS to see available agents.`);
      return;
    }

    if (isTerminalStatus(target.status)) {
      agent.sendMessage(`[System] Agent ${target.id.slice(0, 8)} is ${target.status} and cannot receive messages.`);
      return;
    }

    // Deliver message to target — queue so it doesn't interrupt current work
    const senderLabel = `${agent.role.name} (${agent.id.slice(0, 8)})`;
    target.queueMessage(`[Direct Message from ${senderLabel}]\n${content}`);

    // Acknowledge to sender
    agent.sendMessage(`[System] ✉️ Direct message sent to ${target.role.name} (${target.id.slice(0, 8)}).`);

    // Log the peer communication
    ctx.activityLedger.log(
      agent.id,
      agent.role.id,
      'message_sent',
      `DM to ${target.role.id} (${target.id.slice(0, 8)}): ${content.slice(0, 100)}`,
      { type: 'direct_message', targetId: target.id, targetRole: target.role.id },
    );
  } catch {
    agent.sendMessage('[System] DIRECT_MESSAGE error: use {"to": "agent-id", "content": "your message"}');
  }
}

function handleQueryPeers(ctx: CommandHandlerContext, agent: Agent): void {
  const allAgents = ctx.getAllAgents();

  // Find the shared "lead" for this agent: its parent, or itself if it is the lead
  const myLeadId = agent.parentId ?? agent.id;

  const peers = allAgents.filter((a) => {
    if (a.id === agent.id) return false; // Exclude self
    if (isTerminalStatus(a.status)) return false; // Exclude finished agents
    // Include siblings (same lead) and the agent's own parent
    const theirLeadId = a.parentId ?? a.id;
    return theirLeadId === myLeadId || a.id === agent.parentId;
  });

  if (peers.length === 0) {
    agent.sendMessage('[System] No active peers found.');
    return;
  }

  let msg = '== Active Peers ==\n';
  for (const peer of peers) {
    const statusIcon = peer.status === 'running' ? '🟢' : peer.status === 'idle' ? '🟡' : '⚪';
    msg += `${statusIcon} ${peer.role.name} (${peer.id.slice(0, 8)}) — ${peer.status}`;
    if (peer.task) msg += ` — "${peer.task.slice(0, 60)}"`;
    msg += '\n';
  }
  msg += `\nSend a message: ⟦⟦ DIRECT_MESSAGE {"to": "agent-id", "content": "..."} ⟧⟧`;

  agent.sendMessage(`[System]\n${msg}`);
}

export function getDirectMessageCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: DM_REGEX, name: 'DIRECT_MESSAGE', handler: (a, d) => handleDirectMessage(ctx, a, d) },
    { regex: QUERY_PEERS_REGEX, name: 'QUERY_PEERS', handler: (a) => handleQueryPeers(ctx, a) },
  ];
}
