import { Router } from 'express';
import type { AppContext } from './context.js';
import { DiffService } from '../coordination/files/DiffService.js';
import { ApiError, notFound } from '../errors/index.js';

export function diffRoutes(ctx: AppContext): Router {
  const { agentManager, lockRegistry } = ctx;
  const diffService = new DiffService(lockRegistry, process.cwd());
  const router = Router();

  // GET /api/agents/:id/diff — full diff for agent's locked files
  router.get('/agents/:id/diff', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) throw notFound('Agent not found');

    const useCache = req.query.cached !== 'false';
    try {
      const result = await diffService.getDiff(agent.id, useCache);
      res.json(result);
    } catch (err) {
      throw new ApiError(500, 'Failed to compute diff', { details: (err as Error).message });
    }
  });

  // GET /api/agents/:id/diff/summary — lightweight summary (for badges)
  router.get('/agents/:id/diff/summary', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) throw notFound('Agent not found');

    try {
      const summary = await diffService.getSummary(agent.id);
      res.json(summary);
    } catch (err) {
      throw new ApiError(500, 'Failed to compute diff summary', { details: (err as Error).message });
    }
  });

  return router;
}
