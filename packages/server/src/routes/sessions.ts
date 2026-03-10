import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { spawnLimiter } from './context.js';
import type { AppContext } from './context.js';

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
    if (!session.sessionId) return res.status(400).json({ error: 'Session has no Copilot session ID — cannot resume' });

    // Atomic claim prevents race condition: two concurrent resumes both passing status check
    if (!projectRegistry.claimSessionForResume(session.id)) {
      return res.status(409).json({ error: 'Session is still active or already being resumed' });
    }

    const project = projectRegistry.get(session.projectId);
    if (!project) return res.status(404).json({ error: 'Associated project not found' });

    // Use stored role from session, falling back to 'lead' for backward compatibility
    const roleId = session.role ?? 'lead';
    const role = roleRegistry.get(roleId);
    if (!role) return res.status(500).json({ error: `Role "${roleId}" not found` });

    const { task: overrideTask, model } = req.body ?? {};
    const task = overrideTask || session.task || undefined;

    try {
      const agent = agentManager.spawn(
        role, task, undefined, true, model,
        project.cwd ?? undefined,
        session.sessionId,
        session.leadId,
        { projectName: project.name, projectId: project.id },
      );

      projectRegistry.reactivateSession(session.id, task, roleId);

      // Send briefing once the agent's session is connected
      const briefing = projectRegistry.buildBriefing(project.id);
      if (briefing && briefing.sessions.length > 1) {
        const briefingText = projectRegistry.formatBriefing(briefing);
        agent.onSessionReady(() => {
          agent.sendMessage(`[System — Project Context]\n${briefingText}\n\nYou are resuming a previous session. Continue from where you left off.`);
        });
      }

      logger.info('session', `Resumed session ${idParam} for project "${project.name}" (${agent.id.slice(0, 8)})`);
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error('session', `Failed to resume session: ${err.message}`);
      res.status(429).json({ error: err.message });
    }
  });

  return router;
}
