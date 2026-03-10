import { Router } from 'express';
import type { ServerConfig } from '../config.js';
import { updateConfig, getConfig } from '../config.js';
import { validateBody, configPatchSchema } from '../validation/schemas.js';
import type { AppContext } from './context.js';
import { BudgetEnforcer } from '../coordination/scheduling/BudgetEnforcer.js';
import { CostTracker } from '../agents/CostTracker.js';
import { logger } from '../utils/logger.js';

export function configRoutes(ctx: AppContext): Router {
  const { agentManager, db: _db } = ctx;
  // Use the container's costTracker if available, otherwise create one for backward compat
  const costTracker = ctx.costTracker ?? new CostTracker(_db);
  const budgetEnforcer = new BudgetEnforcer(_db, costTracker);
  const router = Router();

  // --- Config ---
  router.get('/config', (_req, res) => {
    res.json(getConfig());
  });

  // GET /config/yaml — returns only the oversight section (never expose secrets like API keys)
  router.get('/config/yaml', (_req, res) => {
    if (!ctx.configStore) {
      return res.status(503).json({ error: 'Config store not available' });
    }
    res.json({ oversight: ctx.configStore.current.oversight });
  });

  router.patch('/config', validateBody(configPatchSchema), (req, res) => {
    const sanitized: Partial<ServerConfig> = {};
    if (req.body.maxConcurrentAgents !== undefined) {
      sanitized.maxConcurrentAgents = req.body.maxConcurrentAgents;
    }
    if (req.body.host !== undefined) {
      sanitized.host = req.body.host;
    }
    const updated = updateConfig(sanitized);
    agentManager.setMaxConcurrent(updated.maxConcurrentAgents);
    // Persist to YAML config (single source of truth)
    if (ctx.configStore) {
      const yamlPatch: Record<string, unknown> = {};
      if (sanitized.maxConcurrentAgents !== undefined) {
        yamlPatch.server = { maxConcurrentAgents: updated.maxConcurrentAgents };
      }
      if (req.body.oversightLevel !== undefined) {
        yamlPatch.oversight = { ...yamlPatch.oversight as Record<string, unknown> ?? {}, level: req.body.oversightLevel };
      }
      if (req.body.customInstructions !== undefined) {
        yamlPatch.oversight = { ...yamlPatch.oversight as Record<string, unknown> ?? {}, customInstructions: req.body.customInstructions };
      }
      if (Object.keys(yamlPatch).length > 0) {
        ctx.configStore.writePartial(yamlPatch).catch(err => {
          logger.warn({ module: 'config', msg: 'Failed to persist config to YAML', error: (err as Error).message });
        });
      }
    }
    res.json(updated);
  });

  // --- System pause/resume ---
  router.post('/system/pause', (_req, res) => {
    agentManager.pauseSystem();
    res.json({ paused: true });
  });

  router.post('/system/resume', (_req, res) => {
    agentManager.resumeSystem();
    res.json({ paused: false });
  });

  router.get('/system/status', (_req, res) => {
    res.json({ paused: agentManager.isSystemPaused });
  });

  // --- Budget ---
  router.get('/budget', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    if (projectId) budgetEnforcer.setProject(projectId);
    res.json(budgetEnforcer.getStatus());
  });

  router.post('/budget', (req, res) => {
    const { limit, thresholds, projectId } = req.body;
    if (limit !== undefined && limit !== null && (typeof limit !== 'number' || limit < 0)) {
      return res.status(400).json({ error: 'limit must be a positive number, 0 (disabled), or null (unlimited)' });
    }
    budgetEnforcer.setConfig({ limit, thresholds }, projectId);
    res.json({ updated: true, ...budgetEnforcer.getStatus() });
  });

  router.post('/budget/check', (req, res) => {
    const projectId = (req.body?.projectId ?? req.query.projectId) as string | undefined;
    if (projectId) budgetEnforcer.setProject(projectId);
    const result = budgetEnforcer.check();
    if (result.level === 'pause') {
      agentManager.pauseSystem();
    }
    res.json({ ...result, ...budgetEnforcer.getStatus() });
  });

  return router;
}
