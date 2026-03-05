import { Router } from 'express';
import type { AppContext } from './context.js';
import { NotificationService } from '../coordination/NotificationService.js';

export function notificationRoutes(ctx: AppContext): Router {
  const { db } = ctx;
  const service = new NotificationService(db);
  const router = Router();

  // ── Channels ──────────────────────────────────────────────────

  // GET /api/notifications/channels
  router.get('/notifications/channels', (_req, res) => {
    try {
      res.json(service.getChannels());
    } catch (err) {
      res.status(500).json({ error: 'Failed to list channels', detail: (err as Error).message });
    }
  });

  // POST /api/notifications/channels
  router.post('/notifications/channels', (req, res) => {
    try {
      const { type, config, tiers } = req.body ?? {};
      const validTypes = ['desktop', 'slack', 'discord', 'email', 'webhook'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
      }
      if (!config) return res.status(400).json({ error: 'config required' });
      const channel = service.createChannel(type, config, tiers);
      res.status(201).json(channel);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create channel', detail: (err as Error).message });
    }
  });

  // PUT /api/notifications/channels/:id
  router.put('/notifications/channels/:id', (req, res) => {
    try {
      const channel = service.updateChannel(req.params.id, req.body ?? {});
      if (!channel) return res.status(404).json({ error: 'Channel not found' });
      res.json(channel);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update channel', detail: (err as Error).message });
    }
  });

  // DELETE /api/notifications/channels/:id
  router.delete('/notifications/channels/:id', (req, res) => {
    try {
      const deleted = service.deleteChannel(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Channel not found' });
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete channel', detail: (err as Error).message });
    }
  });

  // POST /api/notifications/channels/:id/test
  router.post('/notifications/channels/:id/test', (req, res) => {
    try {
      const result = service.testChannel(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to test channel', detail: (err as Error).message });
    }
  });

  // ── Preferences ───────────────────────────────────────────────

  // GET /api/notifications/preferences
  router.get('/notifications/preferences', (_req, res) => {
    res.json(service.getPreferences());
  });

  // PUT /api/notifications/preferences
  router.put('/notifications/preferences', (req, res) => {
    try {
      const { preferences } = req.body ?? {};
      if (!Array.isArray(preferences)) {
        return res.status(400).json({ error: 'preferences array required' });
      }
      const updated = service.updatePreferences(preferences);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update preferences', detail: (err as Error).message });
    }
  });

  // ── Quiet Hours ───────────────────────────────────────────────

  // GET /api/notifications/quiet-hours
  router.get('/notifications/quiet-hours', (_req, res) => {
    res.json(service.getQuietHours());
  });

  // PUT /api/notifications/quiet-hours
  router.put('/notifications/quiet-hours', (req, res) => {
    try {
      const { enabled, start, end, timezone } = req.body ?? {};
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled required (boolean)' });
      if (!start || !end) return res.status(400).json({ error: 'start and end times required' });
      const config = service.setQuietHours({ enabled, start, end, timezone: timezone ?? 'UTC' });
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update quiet hours', detail: (err as Error).message });
    }
  });

  // ── Notification Log ──────────────────────────────────────────

  // GET /api/notifications/log
  router.get('/notifications/log', (req, res) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(service.getLog(sessionId, page, limit));
    } catch (err) {
      res.status(500).json({ error: 'Failed to get notification log', detail: (err as Error).message });
    }
  });

  return router;
}
