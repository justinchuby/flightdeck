/**
 * System-level command handlers.
 *
 * Commands: QUERY_CREW, HALT_HEARTBEAT, REQUEST_LIMIT_CHANGE
 */
import { isTerminalStatus } from '../Agent.js';
import type { Agent } from '../Agent.js';
import type { MemoryEntry } from '../AgentMemory.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import { parseCommandPayload, requestLimitChangeSchema } from './commandSchemas.js';

// ── Regex patterns ────────────────────────────────────────────────────

const QUERY_CREW_REGEX = /⟦⟦\s*QUERY_CREW\s*⟧⟧/s;
const HALT_HEARTBEAT_REGEX = /⟦⟦\s*HALT_HEARTBEAT\s*⟧⟧/s;
const REQUEST_LIMIT_CHANGE_REGEX = /⟦⟦\s*REQUEST_LIMIT_CHANGE\s*(\{.*?\})\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleQueryCrew(ctx: CommandHandlerContext, agent: Agent): void {
  // Scope to the requesting agent's project to prevent cross-project visibility
  const agentProjectId = ctx.getProjectIdForAgent(agent.id);
  const allAgents = agentProjectId
    ? ctx.getAllAgents().filter((a) => ctx.getProjectIdForAgent(a.id) === agentProjectId)
    : ctx.getAllAgents();
  const roster = allAgents
    .filter((a) => !isTerminalStatus(a.status))
    .map((a) => ({
      id: a.id.slice(0, 8),
      fullId: a.id,
      role: a.role.name,
      roleId: a.role.id,
      status: a.status,
      task: a.task?.slice(0, 80) || null,
      parentId: a.parentId?.slice(0, 8) || null,
      fullParentId: a.parentId || null,
      childCount: a.childIds.length,
      model: a.model || a.role.model || 'default',
    }));

  const running = ctx.getRunningCount();
  const budgetLine = agent.role.id === 'lead'
    ? `\n== AGENT BUDGET ==\nRunning: ${running} / ${ctx.maxConcurrent} | Available slots: ${Math.max(0, ctx.maxConcurrent - running)}${running >= ctx.maxConcurrent ? ' | ⚠ AT CAPACITY' : ''}\n`
    : '';

  // For sub-leads, scope to own children + sibling summary
  const isSubLead = agent.role.id === 'lead' && !!agent.parentId;
  let rosterLines: string;
  let siblingSection = '';
  if (isSubLead) {
    const ownChildren = roster.filter(r => r.fullParentId === agent.id);
    const siblingLeads = roster.filter(r => r.roleId === 'lead' && r.fullParentId === agent.parentId && r.fullId !== agent.id);
    rosterLines = ownChildren
      .map((r) => `- ${r.id} | ${r.role} (${r.roleId}) [${r.model}] | Status: ${r.status} | Task: ${r.task || 'idle'}`)
      .join('\n') || '(no agents created yet — use CREATE_AGENT to create specialists)';
    if (siblingLeads.length > 0) {
      siblingSection = `\n== SIBLING LEADS ==\n${siblingLeads.map(r => `- ${r.id} (${r.role}) — ${r.status}, managing ${r.childCount} agents`).join('\n')}\n`;
    }
  } else {
    const ownAgents = roster.filter(r => r.fullParentId === agent.id || r.fullId === agent.id);
    rosterLines = ownAgents
      .map((r) => `- ${r.id} | ${r.role} (${r.roleId}) [${r.model}] | Status: ${r.status} | Task: ${r.task || 'idle'}`)
      .join('\n') || '(no agents created yet — use CREATE_AGENT to create specialists)';
  }

  // Include memory entries for the lead
  let memorySection = '';
  if (agent.role.id === 'lead') {
    const memories = ctx.agentMemory.getByLead(agent.id);
    if (memories.length > 0) {
      const byAgent = new Map<string, MemoryEntry[]>();
      for (const m of memories) {
        const list = byAgent.get(m.agentId) || [];
        list.push(m);
        byAgent.set(m.agentId, list);
      }
      const lines: string[] = [];
      for (const [agentId, entries] of byAgent) {
        const facts = entries.map(e => `${e.key}: ${e.value}`).join(', ');
        lines.push(`  - ${agentId.slice(0, 8)}: ${facts}`);
      }
      memorySection = `\n== AGENT MEMORY ==\nRecorded facts about your agents:\n${lines.join('\n')}\n`;
    }
  }

  // Check for unread human messages
  let humanMsgIndicator = '';
  if (agent.role.id === 'lead' && !agent.humanMessageResponded && agent.lastHumanMessageAt) {
    const agoMs = Date.now() - agent.lastHumanMessageAt.getTime();
    const agoMin = Math.floor(agoMs / 60000);
    const agoStr = agoMin < 1 ? 'just now' : `${agoMin}m ago`;
    humanMsgIndicator = `\n⚠️ UNREAD HUMAN MESSAGE (${agoStr}): "${agent.lastHumanMessageText}"\nRespond to this FIRST before continuing other work.\n`;
  }

  const response = `⟦⟦ CREW_ROSTER${humanMsgIndicator}
== YOUR CREW (you can DELEGATE to these) ==
${rosterLines}
${budgetLine}${siblingSection}${memorySection}
⚠️ You can only DELEGATE to agents you created (your crew). Agents from other projects will return "Agent not found".
To assign a task to an agent, use their ID:
\`⟦⟦ DELEGATE {"to": "agent-id", "task": "your task"} ⟧⟧\`
To create a new agent:
\`⟦⟦ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "optional task"} ⟧⟧\`
To terminate an agent and free a slot:
\`⟦⟦ TERMINATE_AGENT {"id": "agent-id", "reason": "no longer needed"} ⟧⟧\`
CREW_ROSTER ⟧⟧`;

  logger.info('agent', `QUERY_CREW response sent to ${agent.role.name} (${agent.id.slice(0, 8)}): ${roster.length} agents`);
  agent.sendMessage(response);
}

function handleHaltHeartbeat(ctx: CommandHandlerContext, agent: Agent): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can halt heartbeat.');
    return;
  }
  ctx.markHumanInterrupt(agent.id);
  logger.info('lead', `Heartbeat halted by ${agent.role.name} (${agent.id.slice(0, 8)})`);
  ctx.activityLedger.log(agent.id, agent.role.id, 'heartbeat_halted', `Heartbeat halted by lead`, {});
  agent.sendMessage('[System] Heartbeat nudges paused. They will resume automatically when you start running again.');
}

function handleRequestLimitChange(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can request limit changes.');
    return;
  }
  const match = data.match(REQUEST_LIMIT_CHANGE_REGEX);
  if (!match) return;
  const req = parseCommandPayload(agent, match[1], requestLimitChangeSchema, 'REQUEST_LIMIT_CHANGE');
  if (!req) return;
  try {
    const newLimit = req.limit;
    const currentLimit = ctx.maxConcurrent;
    const decision = ctx.decisionLog.add(
      agent.id,
      agent.role.name,
      `Increase agent limit from ${currentLimit} to ${newLimit}`,
      req.reason || `Need more concurrent agents to parallelize work (current: ${currentLimit}, requested: ${newLimit})`,
      true, // needsConfirmation
      agent.parentId || agent.id,
    );
    ctx.pendingSystemActions.set(decision.id, { type: 'set_max_concurrent', value: newLimit, agentId: agent.id });
    ctx.decisionLog.markSystemDecision(decision.id);
    logger.info('lead', `Limit change requested by ${agent.role.name} (${agent.id.slice(0, 8)}): ${currentLimit} → ${newLimit}`);
    ctx.activityLedger.log(agent.id, agent.role.id, 'limit_change_requested', `Requested agent limit change: ${currentLimit} → ${newLimit}`, { currentLimit, newLimit, reason: req.reason });
    agent.sendMessage(`[System] Your request to change the agent limit from ${currentLimit} to ${newLimit} has been submitted for user approval. You will be notified when the user responds.`);
  } catch {
    agent.sendMessage('[System] REQUEST_LIMIT_CHANGE error: invalid payload. Use {"limit": 15, "reason": "..."}');
  }
}

// ── Module export ─────────────────────────────────────────────────────

export function getSystemCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: QUERY_CREW_REGEX, name: 'QUERY_CREW', handler: (a, _d) => handleQueryCrew(ctx, a) },
    { regex: HALT_HEARTBEAT_REGEX, name: 'HALT_HEARTBEAT', handler: (a, _d) => handleHaltHeartbeat(ctx, a) },
    { regex: REQUEST_LIMIT_CHANGE_REGEX, name: 'REQUEST_LIMIT_CHANGE', handler: (a, d) => handleRequestLimitChange(ctx, a, d) },
  ];
}
