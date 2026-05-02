import { Router } from 'express';
import type { AppContext } from './context.js';
import { NLCommandService } from '../coordination/commands/NLCommandService.js';
import { ApiError, badRequest, notFound } from '../errors/index.js';

export function nlRoutes(ctx: AppContext): Router {
  const { agentManager, decisionLog, activityLedger } = ctx;
  const service = new NLCommandService(agentManager, decisionLog, activityLedger);
  const router = Router();

  // GET /api/nl/commands — list all registered command patterns
  router.get('/nl/commands', (_req, res) => {
    res.json({ commands: service.getPatterns() });
  });

  // POST /api/nl/preview — preview what a command would do (no execution)
  router.post('/nl/preview', (req, res) => {
    const { command, leadId } = req.body as { command?: string; leadId?: string };
    if (!command) throw badRequest('Missing required field: command');
    if (!leadId) throw badRequest('Missing required field: leadId');

    try {
      const plan = service.preview(command, leadId);
      if (!plan) throw notFound('No matching command found');
      res.json(plan);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Preview failed', { details: (err as Error).message });
    }
  });

  // POST /api/nl/execute — match, plan, and execute a command
  router.post('/nl/execute', (req, res) => {
    const { command, leadId } = req.body as { command?: string; leadId?: string };
    if (!command) throw badRequest('Missing required field: command');
    if (!leadId) throw badRequest('Missing required field: leadId');

    try {
      const result = service.execute(command, leadId);
      if (!result) throw notFound('No matching command found');
      res.json(result);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Execution failed', { details: (err as Error).message });
    }
  });

  // POST /api/nl/undo — undo a previously executed command
  router.post('/nl/undo', (req, res) => {
    const { commandId } = req.body as { commandId?: string };
    if (!commandId) throw badRequest('Missing required field: commandId');

    try {
      const result = service.undo(commandId);
      res.json(result);
    } catch (err) {
      throw new ApiError(500, 'Undo failed', { details: (err as Error).message });
    }
  });

  // GET /api/nl/suggestions — context-aware action suggestions
  router.get('/nl/suggestions', (req, res) => {
    const leadId = req.query.leadId as string;
    if (!leadId) throw badRequest('Missing required query param: leadId');

    try {
      const suggestions = service.getSuggestions(leadId);
      res.json({ suggestions });
    } catch (err) {
      throw new ApiError(500, 'Suggestions failed', { details: (err as Error).message });
    }
  });

  // ── Onboarding state (server-side persistence) ──────────────────

  // GET /api/onboarding/status — get user mastery level and progress
  router.get('/onboarding/status', (req, res) => {
    const userId = req.query.userId as string ?? 'default';
    try {
      const raw = ctx.db.getSetting(`onboarding_${userId}`);
      const state = raw ? JSON.parse(raw) : {
        tourComplete: false,
        completedSteps: [],
        tier: 'starter',
        sessionCount: 0,
        coachDismissed: [],
      };
      res.json(state);
    } catch (err) {
      throw new ApiError(500, 'Failed to get onboarding status', { details: (err as Error).message });
    }
  });

  // POST /api/onboarding/progress — update onboarding progress
  router.post('/onboarding/progress', (req, res) => {
    const userId = req.body.userId ?? 'default';
    const updates = req.body as Record<string, any>;
    try {
      const raw = ctx.db.getSetting(`onboarding_${userId}`);
      const state = raw ? JSON.parse(raw) : {
        tourComplete: false,
        completedSteps: [],
        tier: 'starter',
        sessionCount: 0,
        coachDismissed: [],
      };

      // Merge updates
      if (updates.tourComplete !== undefined) state.tourComplete = updates.tourComplete;
      if (updates.completedStep) {
        if (!state.completedSteps.includes(updates.completedStep)) {
          state.completedSteps.push(updates.completedStep);
        }
      }
      if (updates.tier) state.tier = updates.tier;
      if (updates.incrementSession) state.sessionCount++;
      if (updates.coachDismissed) {
        if (!state.coachDismissed.includes(updates.coachDismissed)) {
          state.coachDismissed.push(updates.coachDismissed);
        }
      }

      ctx.db.setSetting(`onboarding_${userId}`, JSON.stringify(state));
      res.json(state);
    } catch (err) {
      throw new ApiError(500, 'Failed to update onboarding', { details: (err as Error).message });
    }
  });

  return router;
}
