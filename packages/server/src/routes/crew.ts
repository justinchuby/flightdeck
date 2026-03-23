/**
 * Crew REST API routes.
 *
 * Endpoints for crew listing, details, agent profiles, health, and crew management.
 *
 * Routes:
 *   GET  /crews                 — list crews
 *   GET  /crews/:crewId         — crew details
 */
import { Router } from 'express';
import { shortAgentId } from '@flightdeck/shared';
import { logger } from '../utils/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { isTerminalStatus } from '../agents/Agent.js';
import { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';
import type { AppContext } from './context.js';

// ── Rate Limiters ───────────────────────────────────────────────────

const readLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'Too many crew read requests' });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Too many crew write requests' });

const AGENT_ID_RE = /^[a-f0-9\-]{8,64}$/i;

/** Extract a single string param (Express 5 may return string | string[]) */
function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] ?? '' : val ?? '';
}

/**
 * Filter DB agents to only those belonging to currently active sessions.
 * An agent is included if:
 * - It is currently live in the AgentManager, OR
 * - It shares a sessionId with a currently live agent
 *   (e.g. terminated agents from the current session still appear)
 * Returns empty array when no agents are live (no active session).
 */
function filterToActiveSession<T extends { agentId: string; sessionId?: string }>(
  dbAgents: T[],
  liveAgents: { id: string; sessionId?: string | null }[],
): T[] {
  if (liveAgents.length === 0) return [];

  const liveIds = new Set(liveAgents.map(a => a.id));
  const activeSessionIds = new Set(
    liveAgents.map(a => a.sessionId).filter((s): s is string => !!s),
  );

  return dbAgents.filter(a =>
    liveIds.has(a.agentId) ||
    (a.sessionId != null && activeSessionIds.has(a.sessionId))
  );
}

// ── Routes ──────────────────────────────────────────────────────────

export function crewRoutes(ctx: AppContext): Router {
  const { knowledgeStore, trainingCapture, agentRoster, agentManager, projectRegistry, db } = ctx;
  const router = Router();


  // ── GET /crews ──────────────────────────────────────────────────

  router.get('/crews', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

      // Project-scoped: query roster directly (includes terminated agents for history).
      // Global: filter to agents with an active session in agentManager.
      const allAgents = projectId
        ? agentRoster.getByProject(projectId)
        : filterToActiveSession(agentRoster.getAllAgents(), agentManager.getAll());

      // Group agents by teamId to build crew list
      const crewMap = new Map<string, { crewId: string; agentCount: number; roles: Set<string> }>();
      for (const agent of allAgents) {
        const tid = agent.teamId ?? 'default';
        if (!crewMap.has(tid)) {
          crewMap.set(tid, { crewId: tid, agentCount: 0, roles: new Set() });
        }
        const crew = crewMap.get(tid)!;
        crew.agentCount++;
        crew.roles.add(agent.role);
      }

      const crews = [...crewMap.values()].map((t) => ({
        crewId: t.crewId,
        agentCount: t.agentCount,
        roles: [...t.roles],
      }));

      res.json({ crews });
    } catch (err: any) {
      logger.error({ module: 'crews', msg: 'Failed to list crews', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /crews/summary — Crew groups with stats ──────────────────

  router.get('/crews/summary', readLimiter, (req, res) => {
    if (!agentRoster) return res.status(503).json({ error: 'Agent roster not available' });

    try {
      const liveAgents = agentManager.getAll();
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

      // Project-scoped: query roster directly; Global: filter to active sessions
      const allAgents = projectId
        ? agentRoster.getByProject(projectId)
        : filterToActiveSession(agentRoster.getAllAgents(), liveAgents);

      // Group agents by their lead (parentId from metadata, or self if role is lead)
      const crewMap = new Map<string, typeof allAgents>();
      for (const agent of allAgents) {
        const meta = agent.metadata as Record<string, unknown> | undefined;
        const metaParentId = (meta?.parentId as string) ?? null;
        // Fall back to live agent's parentId when metadata is missing (older roster entries)
        const liveAgent = liveAgents.find(l => l.id === agent.agentId);
        const parentId = metaParentId ?? liveAgent?.parentId ?? null;
        // If this agent has a parentId, group under that lead. If it IS a lead, group under itself.
        const leadId = agent.role === 'lead' ? agent.agentId : parentId;
        if (!leadId) continue; // orphan agent with no known parent, skip
        const crew = crewMap.get(leadId) ?? [];
        crew.push(agent);
        crewMap.set(leadId, crew);
      }

      const crews = Array.from(crewMap.entries()).map(([leadId, agents]) => {
        const lead = agents.find(a => a.agentId === leadId);
        // Count agents that are actually alive in the agent manager (not just DB status)
        const activeCount = agents.filter(a => {
          const live = liveAgents.find(l => l.id === a.agentId);
          return live != null && (live.status === 'running' || live.status === 'idle' || live.status === 'creating');
        }).length;
        const lastActivity = agents.reduce((max, a) => a.updatedAt > max ? a.updatedAt : max, '');

        // Get project info from lead's live agent or roster
        const liveLeadAgent = liveAgents.find(l => l.id === leadId);
        const projectId = lead?.projectId ?? liveLeadAgent?.projectId ?? null;
        const projectName = liveLeadAgent?.projectName ?? null;
        const project = projectId && projectRegistry ? projectRegistry.get(projectId) : null;

        // Session count from projectRegistry
        const sessionCount = projectId && projectRegistry
          ? projectRegistry.getSessions(projectId).filter(s => s.leadId === leadId).length
          : 0;

        return {
          leadId,
          projectId,
          projectName: projectName ?? project?.name ?? null,
          agentCount: agents.length,
          activeAgentCount: activeCount,
          sessionCount,
          lastActivity,
          agents: agents.map(a => ({
            agentId: a.agentId,
            role: a.role,
            model: a.model,
            status: a.status,
            liveStatus: liveAgents.find(l => l.id === a.agentId)?.status ?? null,
          })),
        };
      });

      // Sort: active crews first, then by last activity
      crews.sort((a, b) => {
        if (a.activeAgentCount > 0 && b.activeAgentCount === 0) return -1;
        if (a.activeAgentCount === 0 && b.activeAgentCount > 0) return 1;
        return b.lastActivity.localeCompare(a.lastActivity);
      });

      res.json(crews);
    } catch (err: any) {
      logger.error({ module: 'crews', msg: 'Failed to get crew summary', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /crews/:crewId ──────────────────────────────────────────

  router.get('/crews/:crewId', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const crewId = Array.isArray(req.params.crewId) ? req.params.crewId[0] : req.params.crewId;

    try {
      const agents = filterToActiveSession(
        agentRoster.getAllAgents(undefined, crewId),
        agentManager.getAll(),
      );

      if (agents.length === 0) {
        return res.status(404).json({ error: `Crew ${crewId} not found or has no agents` });
      }

      const knowledgeCount = knowledgeStore
        ? knowledgeStore.count(crewId)
        : 0;

      const trainingSummary = trainingCapture
        ? trainingCapture.getTrainingSummary(crewId)
        : null;

      res.json({
        crewId,
        agentCount: agents.length,
        agents: agents.map((a) => ({
          agentId: a.agentId,
          role: a.role,
          model: a.model,
          status: a.status,
        })),
        knowledgeCount,
        trainingSummary,
      });
    } catch (err: any) {
      logger.error({ module: 'crews', msg: 'Failed to get crew details', crewId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /crews/:crewId/agents ─────────────────────────────────────

  router.get('/crews/:crewId/agents', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const crewId = paramStr(req.params.crewId);
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const validStatuses = new Set(['idle', 'running', 'terminated', 'failed']);

    if (statusFilter && !validStatuses.has(statusFilter)) {
      return res.status(400).json({ error: `Invalid status filter: ${statusFilter}` });
    }

    try {
      const allLive = agentManager.getAll();
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

      // Project-scoped: query roster by project then filter by team/status;
      // Global: filter to agents with an active session in agentManager.
      const dbAgents = projectId
        ? agentRoster.getByProject(projectId).filter(a =>
            a.teamId === crewId
            && (!statusFilter || a.status === statusFilter))
        : agentRoster.getAllAgents(
            statusFilter as 'idle' | 'running' | 'terminated' | 'failed' | undefined,
            crewId,
          );
      const agents = projectId ? dbAgents : filterToActiveSession(dbAgents, allLive);

      // Enrich with live status from AgentManager
      const enriched = agents.map(a => {
        const live = allLive.find(l => l.id === a.agentId);
        const liveJson = live?.toJSON();
        return {
          agentId: a.agentId,
          role: a.role,
          model: a.model,
          status: a.status,
          liveStatus: live?.status ?? null,
          teamId: a.teamId,
          projectId: a.projectId ?? null,
          parentId: (a.metadata as Record<string, unknown> | undefined)?.parentId as string ?? live?.parentId ?? null,
          sessionId: a.sessionId ?? null,
          lastTaskSummary: a.lastTaskSummary ?? null,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          provider: live?.provider ?? a.provider ?? null,
          inputTokens: liveJson?.inputTokens ?? null,
          outputTokens: liveJson?.outputTokens ?? null,
          contextWindowSize: liveJson?.contextWindowSize ?? null,
          contextWindowUsed: liveJson?.contextWindowUsed ?? null,
          task: liveJson?.task ?? null,
          outputPreview: liveJson?.outputPreview?.slice(-200) ?? null,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      logger.error({ module: 'crews', msg: 'Failed to list crew agents', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /crews/:crewId/agents/:agentId/profile ────────────────────

  router.get('/crews/:crewId/agents/:agentId/profile', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const crewId = paramStr(req.params.crewId);
    const agentId = paramStr(req.params.agentId);

    if (!AGENT_ID_RE.test(agentId)) {
      return res.status(400).json({ error: 'Invalid agentId format' });
    }

    const agent = agentRoster.getAgent(agentId);
    if (!agent || agent.teamId !== crewId) {
      return res.status(404).json({ error: 'Agent not found in this crew' });
    }

    // Live agent info
    const live = agentManager.getAll().find(l => l.id === agentId);
    const liveJson = live?.toJSON();

    // Knowledge count for this agent's project
    let knowledgeCount = 0;
    if (knowledgeStore && agent.projectId) {
      try {
        knowledgeCount = knowledgeStore.count(agent.projectId);
      } catch { /* ignore */ }
    }

    res.json({
      agentId: agent.agentId,
      role: agent.role,
      model: agent.model,
      status: agent.status,
      liveStatus: liveJson?.status ?? null,
      teamId: agent.teamId,
      projectId: agent.projectId ?? null,
      lastTaskSummary: agent.lastTaskSummary ?? null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      knowledgeCount,
      live: liveJson ? {
        task: liveJson.task ?? null,
        outputPreview: liveJson.outputPreview ?? null,
        model: liveJson.model ?? null,
        sessionId: liveJson.sessionId ?? null,
        provider: liveJson.provider ?? null,
        backend: liveJson.backend ?? null,
        exitError: liveJson.exitError ?? null,
      } : null,
    });
  });

  // ── GET /crews/:crewId/health ────────────────────────────────────

  router.get('/crews/:crewId/health', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const crewId = Array.isArray(req.params.crewId) ? req.params.crewId[0] : req.params.crewId;

    try {
      const agents = agentRoster.getAllAgents(undefined, crewId);
      if (agents.length === 0) {
        return res.status(404).json({ error: `Crew ${crewId} not found or has no agents` });
      }

      const statusCounts = agentRoster.getStatusCounts(crewId);
      const now = Date.now();
      const agentDetails = agents.map((a) => {
        const createdMs = new Date(a.createdAt).getTime();
        const uptimeMs = now - createdMs;
        const meta = a.metadata ?? {};
        return {
          agentId: a.agentId,
          role: a.role,
          model: a.model,
          status: a.status,
          uptimeMs,
          lastTaskSummary: a.lastTaskSummary,
          clonedFromId: (meta as any).clonedFromId,
        };
      });

      res.json({
        crewId,
        totalAgents: agents.length,
        statusCounts,
        agents: agentDetails,
      });
    } catch (err: any) {
      logger.error({ module: 'crews', msg: 'Failed to get crew health', crewId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /crews/:crewId/agents/:agentId/clone ──────────────────

  router.post('/crews/:crewId/agents/:agentId/clone', writeLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const agentId = Array.isArray(req.params.agentId) ? req.params.agentId[0] : req.params.agentId;

    try {
      const source = agentRoster.getAgent(agentId);
      if (!source) {
        return res.status(404).json({ error: `Agent ${agentId} not found` });
      }

      const newId = `${shortAgentId(agentId)}-clone-${Date.now().toString(36)}`;
      const clone = agentRoster.cloneAgent(agentId, newId);
      if (!clone) {
        return res.status(500).json({ error: 'Failed to clone agent' });
      }

      logger.info({ module: 'crews', msg: 'Agent cloned', sourceId: agentId, cloneId: newId });
      res.status(201).json({ ok: true, clone });
    } catch (err: any) {
      logger.error({ module: 'crews', msg: 'Failed to clone agent', agentId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a crew (lead + all child agents) from the roster
  router.delete('/crews/:leadId', writeLimiter, (req, res) => {
    if (!agentRoster) return res.status(503).json({ error: 'Agent roster not available' });

    const leadId = paramStr(req.params.leadId);
    const lead = agentRoster.getAgent(leadId);
    if (!lead) return res.status(404).json({ error: 'Crew not found — lead agent not in roster' });

    // Don't allow deleting active crews — only terminated
    const liveAgents = agentManager.getAll();
    const liveLeadAgent = liveAgents.find(a => a.id === leadId);
    if (liveLeadAgent && (liveLeadAgent.status === 'running' || liveLeadAgent.status === 'idle')) {
      return res.status(409).json({ error: 'Cannot delete an active crew. Stop the project first.' });
    }

    const deleted = agentRoster.deleteCrew(leadId);
    logger.info({ module: 'crews', msg: 'Crew deleted', leadId, deleted });
    res.json({ ok: true, deleted });
  });

  // ── DELETE /roster/:agentId — Remove a single agent from roster ────

  router.delete('/roster/:agentId', writeLimiter, (req, res) => {
    if (!agentRoster) return res.status(503).json({ error: 'Agent roster not available' });

    const agentId = paramStr(req.params.agentId);

    if (!AGENT_ID_RE.test(agentId)) {
      return res.status(400).json({ error: 'Invalid agentId format' });
    }

    const agent = agentRoster.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found in roster' });
    }

    // Don't allow deleting active agents — check AgentManager (O(1) lookup)
    const liveAgent = agentManager.get(agentId);
    if (liveAgent && !isTerminalStatus(liveAgent.status)) {
      return res.status(409).json({ error: 'Cannot delete an active agent. Stop the agent first.' });
    }

    // Don't allow deleting lead agents that have children (defense in depth)
    if (agent.role === 'lead' || !agent.metadata?.parentId) {
      // Check if this agent has any children in the roster
      const allAgents = agent.projectId
        ? agentRoster.getByProject(agent.projectId)
        : agentRoster.getAllAgents();

      const hasChildren = allAgents.some(a => {
        const meta = a.metadata as Record<string, unknown> | undefined;
        return meta?.parentId === agentId && a.agentId !== agentId;
      });

      if (hasChildren) {
        return res.status(409).json({
          error: 'Cannot delete a lead agent that has children. Delete the crew instead to remove the lead and all descendants.'
        });
      }
    }

    // Delete delegation records first to avoid FK constraint violations
    const activeDelegations = new ActiveDelegationRepository(db);
    const deletedDelegations = activeDelegations.deleteByAgent(agentId);
    if (deletedDelegations > 0) {
      logger.info({ module: 'crews', msg: 'Deleted delegation records', agentId, count: deletedDelegations });
    }

    const deleted = agentRoster.deleteAgent(agentId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete agent from roster' });
    }

    logger.info({ module: 'crews', msg: 'Agent removed from roster', agentId, role: agent.role });
    res.json({ ok: true, agentId });
  });

  return router;
}
