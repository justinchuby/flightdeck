/**
 * Team REST API routes.
 *
 * Endpoints for team listing, details, agent profiles, health, and crew management.
 *
 * Routes:
 *   GET  /teams                 — list teams
 *   GET  /teams/:teamId         — team details
 */
import { Router } from 'express';
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

// ── Routes ──────────────────────────────────────────────────────────

export function teamsRoutes(ctx: AppContext): Router {
  const { knowledgeStore, trainingCapture, agentRoster, agentManager, projectRegistry, db } = ctx;
  const router = Router();


  // ── GET /teams ──────────────────────────────────────────────────

  router.get('/teams', readLimiter, (_req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    try {
      const allAgents = agentRoster.getAllAgents();

      // Group agents by teamId to build team list
      const teamMap = new Map<string, { teamId: string; agentCount: number; roles: Set<string> }>();
      for (const agent of allAgents) {
        const tid = agent.teamId ?? 'default';
        if (!teamMap.has(tid)) {
          teamMap.set(tid, { teamId: tid, agentCount: 0, roles: new Set() });
        }
        const team = teamMap.get(tid)!;
        team.agentCount++;
        team.roles.add(agent.role);
      }

      const teams = [...teamMap.values()].map((t) => ({
        teamId: t.teamId,
        agentCount: t.agentCount,
        roles: [...t.roles],
      }));

      res.json({ teams });
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Failed to list teams', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /teams/:teamId ──────────────────────────────────────────

  router.get('/teams/:teamId', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const teamId = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;

    try {
      const agents = agentRoster.getAllAgents(undefined, teamId);

      if (agents.length === 0) {
        return res.status(404).json({ error: `Team ${teamId} not found or has no agents` });
      }

      const knowledgeCount = knowledgeStore
        ? knowledgeStore.count(teamId)
        : 0;

      const trainingSummary = trainingCapture
        ? trainingCapture.getTrainingSummary(teamId)
        : null;

      res.json({
        teamId,
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
      logger.error({ module: 'teams', msg: 'Failed to get team details', teamId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /teams/:teamId/agents ─────────────────────────────────────

  router.get('/teams/:teamId/agents', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const teamId = paramStr(req.params.teamId);
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const validStatuses = new Set(['idle', 'busy', 'terminated', 'retired']);

    if (statusFilter && !validStatuses.has(statusFilter)) {
      return res.status(400).json({ error: `Invalid status filter: ${statusFilter}` });
    }

    try {
      const agents = agentRoster.getAllAgents(
        statusFilter as 'idle' | 'busy' | 'terminated' | 'retired' | undefined,
        teamId,
      );

      // Enrich with live status from AgentManager
      const allLive = agentManager.getAll();
      const enriched = agents.map(a => {
        const live = allLive.find(l => l.id === a.agentId);
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
          provider: live?.provider ?? null,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Failed to list team agents', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /teams/:teamId/agents/:agentId/profile ────────────────────

  router.get('/teams/:teamId/agents/:agentId/profile', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const teamId = paramStr(req.params.teamId);
    const agentId = paramStr(req.params.agentId);

    if (!AGENT_ID_RE.test(agentId)) {
      return res.status(400).json({ error: 'Invalid agentId format' });
    }

    const agent = agentRoster.getAgent(agentId);
    if (!agent || agent.teamId !== teamId) {
      return res.status(404).json({ error: 'Agent not found in this team' });
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
      } : null,
    });
  });

  // ── GET /teams/:teamId/health ────────────────────────────────────

  router.get('/teams/:teamId/health', readLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const teamId = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;

    try {
      const agents = agentRoster.getAllAgents(undefined, teamId);
      if (agents.length === 0) {
        return res.status(404).json({ error: `Team ${teamId} not found or has no agents` });
      }

      const statusCounts = agentRoster.getStatusCounts(teamId);
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
          retiredAt: (meta as any).retiredAt,
          clonedFromId: (meta as any).clonedFromId,
        };
      });

      res.json({
        teamId,
        totalAgents: agents.length,
        statusCounts,
        agents: agentDetails,
      });
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Failed to get team health', teamId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /teams/:teamId/agents/:agentId/retire ─────────────────

  router.post('/teams/:teamId/agents/:agentId/retire', writeLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const agentId = Array.isArray(req.params.agentId) ? req.params.agentId[0] : req.params.agentId;
    const { reason } = req.body ?? {};

    try {
      const agent = agentRoster.getAgent(agentId);
      if (!agent) {
        return res.status(404).json({ error: `Agent ${agentId} not found` });
      }

      if (agent.status === 'retired') {
        return res.status(409).json({ error: `Agent ${agentId} is already retired` });
      }

      const ok = agentRoster.retireAgent(agentId, reason);
      if (!ok) {
        return res.status(500).json({ error: 'Failed to retire agent' });
      }

      logger.info({ module: 'teams', msg: 'Agent retired', agentId, reason });
      res.json({ ok: true, agentId, status: 'retired' });
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Failed to retire agent', agentId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /teams/:teamId/agents/:agentId/clone ──────────────────

  router.post('/teams/:teamId/agents/:agentId/clone', writeLimiter, (req, res) => {
    if (!agentRoster) {
      return res.status(503).json({ error: 'Agent roster not available' });
    }

    const agentId = Array.isArray(req.params.agentId) ? req.params.agentId[0] : req.params.agentId;

    try {
      const source = agentRoster.getAgent(agentId);
      if (!source) {
        return res.status(404).json({ error: `Agent ${agentId} not found` });
      }

      const newId = `${agentId.slice(0, 8)}-clone-${Date.now().toString(36)}`;
      const clone = agentRoster.cloneAgent(agentId, newId);
      if (!clone) {
        return res.status(500).json({ error: 'Failed to clone agent' });
      }

      logger.info({ module: 'teams', msg: 'Agent cloned', sourceId: agentId, cloneId: newId });
      res.status(201).json({ ok: true, clone });
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Failed to clone agent', agentId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /crews/summary — Crew groups with stats ──────────────────

  router.get('/crews/summary', readLimiter, (_req, res) => {
    if (!agentRoster) return res.status(503).json({ error: 'Agent roster not available' });

    try {
      const allAgents = agentRoster.getAllAgents();
      const liveAgents = agentManager.getAll();

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
      logger.error({ module: 'teams', msg: 'Failed to get crew summary', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a crew (lead + all child agents) from the roster
  router.delete('/crews/:leadId', writeLimiter, (req, res) => {
    if (!agentRoster) return res.status(503).json({ error: 'Agent roster not available' });

    const leadId = paramStr(req.params.leadId);
    const lead = agentRoster.getAgent(leadId);
    if (!lead) return res.status(404).json({ error: 'Crew not found — lead agent not in roster' });

    // Don't allow deleting active crews — only terminated/retired
    const liveAgents = agentManager.getAll();
    const liveLeadAgent = liveAgents.find(a => a.id === leadId);
    if (liveLeadAgent && (liveLeadAgent.status === 'running' || liveLeadAgent.status === 'idle')) {
      return res.status(409).json({ error: 'Cannot delete an active crew. Stop the project first.' });
    }

    const deleted = agentRoster.deleteCrew(leadId);
    logger.info({ module: 'teams', msg: 'Crew deleted', leadId, deleted });
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
      logger.info({ module: 'teams', msg: 'Deleted delegation records', agentId, count: deletedDelegations });
    }

    const deleted = agentRoster.deleteAgent(agentId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete agent from roster' });
    }

    logger.info({ module: 'teams', msg: 'Agent removed from roster', agentId, role: agent.role });
    res.json({ ok: true, agentId });
  });

  return router;
}
