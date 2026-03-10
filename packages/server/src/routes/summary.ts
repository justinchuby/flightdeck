import { Router } from 'express';
import type { AppContext } from './context.js';
import { CatchUpService } from '../coordination/sessions/CatchUpSummary.js';

export function summaryRoutes(ctx: AppContext): Router {
  const { agentManager, activityLedger, decisionLog } = ctx;
  const router = Router();

  router.get('/summary/:leadId/since', (req, res) => {
    const { leadId } = req.params;
    const since = req.query.t as string;
    if (!since) {
      return res.status(400).json({ error: 'Missing required query param: t (ISO timestamp)' });
    }

    const taskDAG = agentManager.getTaskDAG?.() ?? null;
    const service = new CatchUpService(activityLedger, taskDAG, decisionLog);

    try {
      const summary = service.getSummary(leadId, since);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate summary', detail: (err as Error).message });
    }
  });

  // Alias: GET /api/catchup/:leadId?since= (cleaner REST URL)
  router.get('/catchup/:leadId', (req, res) => {
    const { leadId } = req.params;
    const since = (req.query.since ?? req.query.t) as string;
    if (!since) {
      return res.status(400).json({ error: 'Missing required query param: since (ISO timestamp)' });
    }

    const taskDAG = agentManager.getTaskDAG?.() ?? null;
    const service = new CatchUpService(activityLedger, taskDAG, decisionLog);

    try {
      const summary = service.getSummary(leadId, since);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate summary', detail: (err as Error).message });
    }
  });

  return router;
}
