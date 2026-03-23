import { Router } from 'express';
import type { AppContext } from './context.js';
import { AnalyticsService } from '../coordination/reporting/AnalyticsService.js';
import { ApiError, badRequest } from '../errors/index.js';

export function analyticsRoutes(ctx: AppContext): Router {
  const { db } = ctx;
  const service = new AnalyticsService(db);
  const router = Router();

  // GET /api/analytics — overview across all sessions
  router.get('/analytics', (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const overview = service.getOverview(projectId);
      res.json(overview);
    } catch (err) {
      throw new ApiError(500, 'Failed to compute analytics', { details: (err as Error).message });
    }
  });

  // GET /api/analytics/sessions — list past sessions with summary data
  router.get('/analytics/sessions', (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const sessions = service.getSessions(projectId);
      res.json({ sessions });
    } catch (err) {
      throw new ApiError(500, 'Failed to list sessions', { details: (err as Error).message });
    }
  });

  // GET /api/analytics/compare — compare sessions side by side
  router.get('/analytics/compare', (req, res) => {
    const sessionsParam = req.query.sessions as string;
    if (!sessionsParam) {
      throw badRequest('Missing required query param: sessions (comma-separated leadIds)');
    }
    const leadIds = sessionsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (leadIds.length < 2) {
      throw badRequest('At least 2 session IDs required for comparison');
    }

    try {
      const comparison = service.compare(leadIds);
      res.json(comparison);
    } catch (err) {
      throw new ApiError(500, 'Failed to compare sessions', { details: (err as Error).message });
    }
  });

  return router;
}
