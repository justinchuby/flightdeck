import { Router } from 'express';
import type { AppContext } from './context.js';
import { CatchUpService } from '../coordination/sessions/CatchUpSummary.js';
import { badRequest, internalError } from '../errors/index.js';
import { logger } from '../utils/logger.js';

export function summaryRoutes(ctx: AppContext): Router {
  const { agentManager, activityLedger, decisionLog } = ctx;
  const router = Router();

  router.get('/summary/:leadId/since', (req, res) => {
    const { leadId } = req.params;
    const since = req.query.t as string;
    if (!since) {
      throw badRequest('Missing required query param: t (ISO timestamp)');
    }

    const taskDAG = agentManager.getTaskDAG?.() ?? null;
    const service = new CatchUpService(activityLedger, taskDAG, decisionLog);

    try {
      const summary = service.getSummary(leadId, since);
      res.json(summary);
    } catch (err) {
      logger.error({ module: 'summary', msg: 'Failed to generate summary', err: (err as Error).message });
      throw internalError('Failed to generate summary');
    }
  });

  // Alias: GET /api/catchup/:leadId?since= (cleaner REST URL)
  router.get('/catchup/:leadId', (req, res) => {
    const { leadId } = req.params;
    const since = (req.query.since ?? req.query.t) as string;
    if (!since) {
      throw badRequest('Missing required query param: since (ISO timestamp)');
    }

    const taskDAG = agentManager.getTaskDAG?.() ?? null;
    const service = new CatchUpService(activityLedger, taskDAG, decisionLog);

    try {
      const summary = service.getSummary(leadId, since);
      res.json(summary);
    } catch (err) {
      logger.error({ module: 'summary', msg: 'Failed to generate summary', err: (err as Error).message });
      throw internalError('Failed to generate summary');
    }
  });

  return router;
}
