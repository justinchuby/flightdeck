import { Router } from 'express';
import type { AppContext } from './context.js';
import { DiffService } from '../coordination/files/DiffService.js';

export function diffRoutes(ctx: AppContext): Router {
  const { agentManager, lockRegistry } = ctx;
  const diffService = new DiffService(lockRegistry, process.cwd());
  const router = Router();

  // GET /api/agents/:id/diff — full diff for agent's locked files
  router.get('/agents/:id/diff', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const useCache = req.query.cached !== 'false';
    try {
      const result = await diffService.getDiff(agent.id, useCache);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute diff', detail: (err as Error).message });
    }
  });

  // GET /api/agents/:id/diff/summary — lightweight summary (for badges)
  router.get('/agents/:id/diff/summary', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    try {
      const summary = await diffService.getSummary(agent.id);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute diff summary', detail: (err as Error).message });
    }
  });

  return router;
}
