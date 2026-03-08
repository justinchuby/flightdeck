import { Router } from 'express';
import type { AppContext } from './context.js';
import { DebateDetector } from '../coordination/decisions/DebateDetector.js';

export function debateRoutes(ctx: AppContext): Router {
  const { agentManager } = ctx;
  const chatGroupRegistry = agentManager.getChatGroupRegistry();
  const detector = new DebateDetector(chatGroupRegistry);
  const router = Router();

  // GET /api/debates/:leadId — detect debates in group chat messages
  router.get('/debates/:leadId', (req, res) => {
    try {
      const { leadId } = req.params;
      const since = req.query.since as string | undefined;
      const status = req.query.status as string | undefined;
      let debates = detector.detectDebates(leadId, since);
      if (status && status !== 'all') {
        debates = debates.filter(d => d.status === status);
      }
      res.json({ debates, count: debates.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to detect debates', detail: (err as Error).message });
    }
  });

  return router;
}
