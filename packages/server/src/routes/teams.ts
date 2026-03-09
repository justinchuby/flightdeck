/**
 * Team REST API routes.
 *
 * Endpoints for team export, import (stub), listing, and details.
 * Export is fully wired via TeamExporter; import is stubbed pending AS25.
 *
 * Routes:
 *   POST /teams/:teamId/export  — export team bundle to directory
 *   POST /teams/import          — import team bundle (stub)
 *   GET  /teams                 — list teams
 *   GET  /teams/:teamId         — team details
 */
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
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
  const { teamExporter, teamImporter, knowledgeStore, trainingCapture, agentRoster, agentManager } = ctx;
  const router = Router();

  // ── POST /teams/:teamId/export ──────────────────────────────────

  router.post('/teams/:teamId/export', writeLimiter, (req, res) => {
    if (!teamExporter) {
      return res.status(503).json({ error: 'Team exporter not available' });
    }

    const teamId = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
    if (!teamId || teamId.length === 0) {
      return res.status(400).json({ error: 'teamId is required' });
    }

    const { outputPath, agents, categories, includeKnowledge, includeTraining, excludeEpisodic } = req.body ?? {};

    try {
      if (outputPath && typeof outputPath === 'string') {
        // Directory export
        const result = teamExporter.exportToDirectory(teamId, outputPath, {
          agentIds: agents,
          categories,
          includeKnowledge,
          includeTraining,
          excludeEpisodic,
        });

        logger.info({ module: 'teams', msg: 'Crew exported to directory', teamId, outputDir: result.outputDir });
        res.json({
          success: true,
          bundlePath: result.outputDir,
          manifest: result.bundle.manifest,
          filesWritten: result.filesWritten?.length ?? 0,
        });
      } else {
        // In-memory export (return bundle as JSON)
        const bundle = teamExporter.exportBundle(teamId, {
          agentIds: agents,
          categories,
          includeKnowledge,
          includeTraining,
          excludeEpisodic,
        });

        logger.info({ module: 'teams', msg: 'Crew exported as JSON', teamId, stats: bundle.manifest.stats });
        res.json({
          success: true,
          bundle,
        });
      }
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Crew export failed', teamId, err: err.message });
      res.status(500).json({ error: `Export failed: ${err.message}` });
    }
  });

  // ── POST /teams/import ──────────────────────────────────────────

  router.post('/teams/import', writeLimiter, (req, res) => {
    if (!teamImporter) {
      return res.status(503).json({ error: 'Team importer not available' });
    }

    const { bundle, projectId, teamId, agentConflict, knowledgeConflict, dryRun } = req.body ?? {};

    if (!bundle || typeof bundle !== 'object') {
      return res.status(400).json({ error: 'Request body must include a "bundle" object' });
    }
    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: '"projectId" is required' });
    }

    try {
      const report = teamImporter.import(bundle, {
        projectId,
        teamId,
        agentConflict: agentConflict ?? 'skip',
        knowledgeConflict: knowledgeConflict ?? 'prefer_existing',
        dryRun: dryRun === true,
      });

      if (!report.success) {
        logger.warn({ module: 'teams', msg: 'Crew import validation failed', projectId, issues: report.validation.issues.length });
        return res.status(422).json({ success: false, report });
      }

      logger.info({ module: 'teams', msg: 'Crew imported', projectId, teamId: report.teamId, dryRun });
      res.json({ success: true, report });
    } catch (err: any) {
      logger.error({ module: 'teams', msg: 'Crew import failed', projectId, err: err.message });
      res.status(500).json({ error: `Import failed: ${err.message}` });
    }
  });

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
        autopilot: liveJson.autopilot ?? false,
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

      // Mass failure status from context (if available)
      const massFailurePaused = ctx.massFailureDetector?.isPaused ?? false;

      res.json({
        teamId,
        totalAgents: agents.length,
        statusCounts,
        massFailurePaused,
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

  return router;
}
