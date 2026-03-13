import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { spawnLimiter } from './context.js';
import type { AppContext } from './context.js';
import { resumeLeadSession, ResumeError } from './resumeHelper.js';

export function sessionsRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, projectRegistry } = ctx;
  const router = Router();

  // --- Session Resume ---

  // List sessions that can be resumed (have a Copilot sessionId and are no longer active)
  router.get('/sessions/resumable', (_req, res) => {
    if (!projectRegistry) return res.json([]);
    const sessions = projectRegistry.getResumableSessions();
    res.json(sessions);
  });

  // Resume a specific session by its row ID or Copilot session ID
  router.post('/sessions/:id/resume', spawnLimiter, (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });

    const idParam = req.params.id as string;
    const sessionRowId = Number(idParam);
    const session = isNaN(sessionRowId)
      ? projectRegistry.getSessionByCopilotId(idParam)
      : projectRegistry.getSessionById(sessionRowId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const project = projectRegistry.get(session.projectId);
    if (!project) return res.status(404).json({ error: 'Associated project not found' });

    const { task: overrideTask, model } = req.body ?? {};

    try {
      const { agent } = resumeLeadSession(
        { session, project, task: overrideTask, model },
        { agentManager, roleRegistry, projectRegistry },
      );

      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      if (err instanceof ResumeError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      logger.error({ module: 'session', msg: 'Failed to resume session', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
