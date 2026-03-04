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
import { formatQueryCrew } from '../../coordination/CrewFormatter.js';
import type { CrewMember } from '../../coordination/CrewFormatter.js';

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

  const lockRegistry = ctx.lockRegistry;
  const allLocks = lockRegistry.getAll();

  // Build CrewMember list from live agents
  const members: CrewMember[] = allAgents
    .filter((a) => !isTerminalStatus(a.status))
    .map((a) => ({
      id: a.id,
      role: a.role.id,
      roleName: a.role.name,
      status: a.status,
      task: a.task?.slice(0, 80) || undefined,
      model: a.model || a.role.model || 'default',
      parentId: a.parentId || undefined,
      isSystemAgent: a.isSystemAgent || undefined,
      lockedFiles: allLocks.filter(l => l.agentId === a.id).map(l => l.filePath),
      pendingMessages: a.pendingMessageCount,
      createdAt: a.createdAt.toISOString(),
      contextWindowSize: a.contextWindowSize,
      contextWindowUsed: a.contextWindowUsed,
    }));

  const running = ctx.getRunningCount();
  const budget = agent.role.id === 'lead'
    ? { running, max: ctx.maxConcurrent }
    : undefined;

  // For sub-leads, scope to own children + sibling summary
  const isSubLead = agent.role.id === 'lead' && !!agent.parentId;
  let siblingSection: string | undefined;
  let visibleMembers: CrewMember[];

  if (isSubLead) {
    visibleMembers = members.filter(m => m.parentId === agent.id);
    const siblingLeads = members.filter(m => m.role === 'lead' && m.parentId === agent.parentId && m.id !== agent.id);
    if (siblingLeads.length > 0) {
      const lines = siblingLeads.map(r => `- ${r.id.slice(0, 8)} (${r.roleName}) — ${r.status}`);
      siblingSection = `== SIBLING LEADS ==\n${lines.join('\n')}`;
    }
  } else {
    visibleMembers = members.filter(m => m.parentId === agent.id || m.id === agent.id);
  }

  // Include memory entries for the lead
  let memorySection: string | undefined;
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
      memorySection = `== AGENT MEMORY ==\nRecorded facts about your agents:\n${lines.join('\n')}`;
    }
  }

  // Check for unread human messages
  let humanMessageAlert: string | undefined;
  if (agent.role.id === 'lead' && !agent.humanMessageResponded && agent.lastHumanMessageAt) {
    const agoMs = Date.now() - agent.lastHumanMessageAt.getTime();
    const agoMin = Math.floor(agoMs / 60000);
    const agoStr = agoMin < 1 ? 'just now' : `${agoMin}m ago`;
    humanMessageAlert = `⚠️ UNREAD HUMAN MESSAGE (${agoStr}): "${agent.lastHumanMessageText}"\nRespond to this FIRST before continuing other work.`;
  }

  const formatted = formatQueryCrew(visibleMembers, {
    viewerId: agent.id,
    viewerRole: agent.role.id,
    budget,
    siblingSection,
    memorySection,
    humanMessageAlert,
  });

  const response = `⟦⟦ CREW_ROSTER\n${formatted}\nCREW_ROSTER ⟧⟧`;

  logger.info('agent', `QUERY_CREW response sent to ${agent.role.name} (${agent.id.slice(0, 8)}): ${visibleMembers.length} agents`);
  agent.sendMessage(response);
}

function handleHaltHeartbeat(ctx: CommandHandlerContext, agent: Agent): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can halt heartbeat.');
    return;
  }
  ctx.markHumanInterrupt(agent.id);
  logger.info('lead', `Heartbeat halted by ${agent.role.name} (${agent.id.slice(0, 8)})`);
  ctx.activityLedger.log(agent.id, agent.role.id, 'heartbeat_halted', `Heartbeat halted by lead`, {}, ctx.getProjectIdForAgent(agent.id) ?? '');
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
    ctx.activityLedger.log(agent.id, agent.role.id, 'limit_change_requested', `Requested agent limit change: ${currentLimit} → ${newLimit}`, { currentLimit, newLimit, reason: req.reason }, ctx.getProjectIdForAgent(agent.id) ?? '');
    agent.sendMessage(`[System] Your request to change the agent limit from ${currentLimit} to ${newLimit} has been submitted for user approval. You will be notified when the user responds.`);
  } catch {
    agent.sendMessage('[System] REQUEST_LIMIT_CHANGE error: invalid payload. Use {"limit": 15, "reason": "..."}');
  }
}

// ── Module export ─────────────────────────────────────────────────────

export function getSystemCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: QUERY_CREW_REGEX, name: 'QUERY_CREW', handler: (a, _d) => handleQueryCrew(ctx, a), help: { description: 'Get current crew status', example: 'QUERY_CREW {}', category: 'System' } },
    { regex: HALT_HEARTBEAT_REGEX, name: 'HALT_HEARTBEAT', handler: (a, _d) => handleHaltHeartbeat(ctx, a), help: { description: 'Stop heartbeat reminder nudges', example: 'HALT_HEARTBEAT {}', category: 'System' } },
    { regex: REQUEST_LIMIT_CHANGE_REGEX, name: 'REQUEST_LIMIT_CHANGE', handler: (a, d) => handleRequestLimitChange(ctx, a, d), help: { description: 'Request a change to concurrency limits', example: 'REQUEST_LIMIT_CHANGE {"limit": 10, "reason": "need more agents"}', category: 'System', args: [
      { name: 'limit', type: 'number', required: true, description: 'New agent concurrency limit (1-100)' },
      { name: 'reason', type: 'string', required: false, description: 'Why the increase is needed' },
    ] } },
  ];
}
