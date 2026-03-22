/**
 * System-level command handlers.
 *
 * Commands: QUERY_CREW, HALT_HEARTBEAT, REQUEST_LIMIT_CHANGE, QUERY_PROVIDERS
 */
import { isTerminalStatus } from '../Agent.js';
import type { Agent } from '../Agent.js';
import type { MemoryEntry } from '../AgentMemory.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import { parseCommandPayload, requestLimitChangeSchema } from './commandSchemas.js';
import { deriveArgs } from './CommandHelp.js';
import { formatQueryCrew } from '../../coordination/agents/CrewFormatter.js';
import type { CrewMember } from '../../coordination/agents/CrewFormatter.js';
import { PROVIDER_PRESETS } from '../../adapters/presets.js';

// ── Regex patterns ────────────────────────────────────────────────────

const QUERY_CREW_REGEX = /⟦⟦\s*QUERY_CREW\s*(?:\{[^}]*\})?\s*⟧⟧/s;
const HALT_HEARTBEAT_REGEX = /⟦⟦\s*HALT_HEARTBEAT\s*(?:\{[^}]*\})?\s*⟧⟧/s;
const RESUME_HEARTBEAT_REGEX = /⟦⟦\s*RESUME_HEARTBEAT\s*(?:\{[^}]*\})?\s*⟧⟧/s;
const REQUEST_LIMIT_CHANGE_REGEX = /⟦⟦\s*REQUEST_LIMIT_CHANGE\s*(\{.*?\})\s*⟧⟧/s;
const QUERY_PROVIDERS_REGEX = /⟦⟦\s*QUERY_PROVIDERS\s*(?:\{[^}]*\})?\s*⟧⟧/s;

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
      // Filter out role and model — already in crew roster, stored model can be stale
      const REDUNDANT_KEYS = new Set(['role', 'model']);
      for (const m of memories) {
        if (REDUNDANT_KEYS.has(m.key)) continue;
        const list = byAgent.get(m.agentId) || [];
        list.push(m);
        byAgent.set(m.agentId, list);
      }
      const lines: string[] = [];
      for (const [agentId, entries] of byAgent) {
        const facts = entries.map(e => `${e.key}: ${e.value}`).join(', ');
        lines.push(`  - ${agentId.slice(0, 8)}: ${facts}`);
      }
      if (lines.length > 0) {
      memorySection = `== AGENT MEMORY ==\nRecorded facts about your agents:\n${lines.join('\n')}`;
      }
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
  const newlyHalted = ctx.haltHeartbeat(agent.id);
  if (!newlyHalted) return; // Already halted — don't spam the notification
  logger.info('agent', `Heartbeat halted by ${agent.role.name} (${agent.id.slice(0, 8)})`);
  ctx.activityLedger.log(agent.id, agent.role?.id ?? 'unknown', 'heartbeat_halted', `Heartbeat halted by ${agent.role.name}`, {}, ctx.getProjectIdForAgent(agent.id) ?? '');
  agent.sendMessage('[System] Heartbeat paused (lead idle nudges). Command reminders are unaffected. Use RESUME_HEARTBEAT to re-enable nudges.');
}

function handleResumeHeartbeat(ctx: CommandHandlerContext, agent: Agent): void {
  const wasHalted = ctx.resumeHeartbeat(agent.id);
  if (!wasHalted) return; // Wasn't halted — nothing to resume
  logger.info('agent', `Heartbeat resumed by ${agent.role.name} (${agent.id.slice(0, 8)})`);
  ctx.activityLedger.log(agent.id, agent.role?.id ?? 'unknown', 'status_change', `Heartbeat resumed by ${agent.role.name}`, {}, ctx.getProjectIdForAgent(agent.id) ?? '');
  agent.sendMessage('[System] Heartbeat resumed. Lead idle nudges are active again.');
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

function handleQueryProviders(ctx: CommandHandlerContext, agent: Agent): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can query providers.');
    return;
  }

  const pm = ctx.providerManager;
  if (!pm) {
    agent.sendMessage('[System] Provider information is not available yet.');
    return;
  }

  const ranking = pm.getProviderRanking();
  const lines: string[] = ['== AVAILABLE PROVIDERS (ranked by preference) =='];

  for (let i = 0; i < ranking.length; i++) {
    const id = ranking[i];
    const preset = PROVIDER_PRESETS[id as keyof typeof PROVIDER_PRESETS];
    if (!preset) continue;
    const status = pm.getProviderStatus(id);
    const enabled = status?.enabled ?? false;
    const installed = status?.installed ?? false;
    const flag = enabled && installed ? '✓' : enabled ? '⚠ not installed' : '✗ disabled';
    lines.push(`  ${i + 1}. ${preset.name} (${id}) — ${flag}`);
    if (preset.defaultModel) {
      lines.push(`     Default model: ${preset.defaultModel}`);
    }
    lines.push(`     Resume support: ${preset.supportsLoadSession ? 'yes' : 'no'}`);
  }

  // Include project model config if available
  const projectId = ctx.getProjectIdForAgent(agent.id);
  if (projectId && ctx.projectRegistry) {
    const { config } = ctx.projectRegistry.getModelConfig(projectId);
    const roles = Object.keys(config);
    if (roles.length > 0) {
      lines.push('');
      lines.push('== PROJECT MODEL CONFIGURATION ==');
      for (const role of roles) {
        const allowed = config[role];
        if (allowed && allowed.length > 0) {
          lines.push(`  ${role}: ${allowed.join(', ')}`);
        }
      }
    }
  }

  const response = `[System]\n${lines.join('\n')}`;
  logger.info('agent', `QUERY_PROVIDERS response sent to ${agent.role.name} (${agent.id.slice(0, 8)})`);
  agent.sendMessage(response);
}

export function getSystemCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: QUERY_CREW_REGEX, name: 'QUERY_CREW', handler: (a, _d) => handleQueryCrew(ctx, a), help: { description: 'Get current crew status', example: 'QUERY_CREW', category: 'System' } },
    { regex: HALT_HEARTBEAT_REGEX, name: 'HALT_HEARTBEAT', handler: (a, _d) => handleHaltHeartbeat(ctx, a), help: { description: 'Stop all heartbeat reminders until RESUME_HEARTBEAT', example: 'HALT_HEARTBEAT', category: 'System' } },
    { regex: RESUME_HEARTBEAT_REGEX, name: 'RESUME_HEARTBEAT', handler: (a, _d) => handleResumeHeartbeat(ctx, a), help: { description: 'Resume heartbeat reminders after HALT_HEARTBEAT', example: 'RESUME_HEARTBEAT', category: 'System' } },
    { regex: REQUEST_LIMIT_CHANGE_REGEX, name: 'REQUEST_LIMIT_CHANGE', handler: (a, d) => handleRequestLimitChange(ctx, a, d), help: { description: 'Request a change to concurrency limits', example: 'REQUEST_LIMIT_CHANGE {"limit": 10, "reason": "need more agents"}', category: 'System', args: deriveArgs(requestLimitChangeSchema) } },
    { regex: QUERY_PROVIDERS_REGEX, name: 'QUERY_PROVIDERS', handler: (a, _d) => handleQueryProviders(ctx, a), help: { description: 'Get available providers, models, and ranking', example: 'QUERY_PROVIDERS', category: 'System' } },
  ];
}
