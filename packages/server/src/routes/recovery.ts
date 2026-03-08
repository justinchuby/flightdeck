import { Router } from 'express';
import type { AppContext } from './context.js';
import { RecoveryService } from '../coordination/recovery/RecoveryService.js';

export function recoveryRoutes(ctx: AppContext): Router {
  const { db, lockRegistry, activityLedger, decisionLog } = ctx;
  const service = new RecoveryService(db, lockRegistry, activityLedger, decisionLog);
  const router = Router();

  // GET /api/recovery — list all recovery events
  router.get('/recovery', (_req, res) => {
    try {
      const events = service.getEvents();
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: 'Failed to list recovery events', detail: (err as Error).message });
    }
  });

  // GET /api/recovery/metrics — recovery metrics
  router.get('/recovery/metrics', (_req, res) => {
    try {
      const metrics = service.getMetrics();
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get recovery metrics', detail: (err as Error).message });
    }
  });

  // GET /api/recovery/:id — get single recovery event with full briefing
  router.get('/recovery/:id', (req, res) => {
    try {
      const event = service.getEvent(req.params.id);
      if (!event) return res.status(404).json({ error: 'Recovery event not found' });
      res.json(event);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get recovery event', detail: (err as Error).message });
    }
  });

  // POST /api/recovery — initiate a recovery (used by auto-recovery or manual trigger)
  router.post('/recovery', (req, res) => {
    try {
      const { originalAgentId, trigger, sessionId, lastMessages, currentTask, contextUsage } = req.body ?? {};
      if (!originalAgentId) return res.status(400).json({ error: 'originalAgentId required' });
      const validTriggers = ['crash', 'unresponsive', 'context_exhaustion', 'manual'];
      if (!validTriggers.includes(trigger)) {
        return res.status(400).json({ error: `trigger must be one of: ${validTriggers.join(', ')}` });
      }
      const event = service.startRecovery({ originalAgentId, trigger, sessionId, lastMessages, currentTask, contextUsage });
      res.status(201).json(event);
    } catch (err) {
      res.status(500).json({ error: 'Failed to start recovery', detail: (err as Error).message });
    }
  });

  // POST /api/recovery/:id/approve — approve handoff and proceed
  router.post('/recovery/:id/approve', (req, res) => {
    try {
      const event = service.approveRecovery(req.params.id);
      if (!event) return res.status(404).json({ error: 'Recovery event not found or not in approvable state' });
      res.json({ status: 'ok', event });
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve recovery', detail: (err as Error).message });
    }
  });

  // POST /api/recovery/:id/complete — mark recovery as completed
  router.post('/recovery/:id/complete', (req, res) => {
    try {
      const { replacementAgentId } = req.body ?? {};
      const event = service.completeRecovery(req.params.id, replacementAgentId);
      if (!event) return res.status(404).json({ error: 'Recovery event not found' });
      res.json({ status: 'ok', event });
    } catch (err) {
      res.status(500).json({ error: 'Failed to complete recovery', detail: (err as Error).message });
    }
  });

  // POST /api/recovery/:id/cancel — cancel a pending recovery
  router.post('/recovery/:id/cancel', (req, res) => {
    try {
      const event = service.cancelRecovery(req.params.id);
      if (!event) return res.status(404).json({ error: 'Recovery event not found or already terminal' });
      res.json({ status: 'ok', event });
    } catch (err) {
      res.status(500).json({ error: 'Failed to cancel recovery', detail: (err as Error).message });
    }
  });

  // PUT /api/recovery/:id/briefing — edit briefing before restart
  router.put('/recovery/:id/briefing', (req, res) => {
    try {
      const { narrative, sections } = req.body ?? {};
      const event = service.updateBriefing(req.params.id, { narrative, sections });
      if (!event) return res.status(404).json({ error: 'Recovery event not found or not editable' });
      res.json({ status: 'ok', event });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update briefing', detail: (err as Error).message });
    }
  });

  // GET /api/settings/recovery — get recovery settings
  router.get('/settings/recovery', (_req, res) => {
    res.json(service.getSettings());
  });

  // PUT /api/settings/recovery — update recovery settings
  router.put('/settings/recovery', (req, res) => {
    try {
      const settings = service.updateSettings(req.body ?? {});
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update settings', detail: (err as Error).message });
    }
  });

  return router;
}
