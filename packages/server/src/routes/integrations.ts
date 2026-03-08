// packages/server/src/routes/integrations.ts
// REST endpoints for managing messaging integrations.

import { Router } from 'express';
import type { AppContext } from './context.js';
import { rateLimit } from '../middleware/rateLimit.js';

const integrationLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'Too many integration requests' });

export function integrationRoutes(ctx: AppContext): Router {
  const router = Router();

  // Apply rate limiting to all integration routes
  router.use('/integrations', integrationLimiter);

  // ── Status ────────────────────────────────────────────────

  // GET /api/integrations/status
  router.get('/integrations/status', (_req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) {
        return res.json({ enabled: false, adapters: [], sessions: [] });
      }

      const telegram = agent.getAdapter('telegram');
      const adapters = [];
      if (telegram) {
        adapters.push({
          platform: 'telegram',
          running: (telegram as any).isRunning?.() ?? true,
        });
      }

      const sessions = agent.getAllSessions();
      const bridge = agent.getBridge();

      res.json({
        enabled: true,
        adapters,
        sessions: sessions.map(s => ({
          chatId: s.chatId,
          platform: s.platform,
          projectId: s.projectId,
          boundBy: s.boundBy,
          expiresAt: new Date(s.expiresAt).toISOString(),
        })),
        pendingNotifications: bridge.pendingCount(),
        subscriptions: bridge.getAllSubscriptions().length,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get integration status', detail: (err as Error).message });
    }
  });

  // ── Session Management ────────────────────────────────────

  // POST /api/integrations/sessions
  router.post('/integrations/sessions', (req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, platform, projectId, boundBy } = req.body ?? {};
      if (!chatId || !platform || !projectId) {
        return res.status(400).json({ error: 'chatId, platform, and projectId are required' });
      }

      const session = agent.bindSession(chatId, platform, projectId, boundBy ?? 'api');
      res.status(201).json(session);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create session', detail: (err as Error).message });
    }
  });

  // GET /api/integrations/sessions
  router.get('/integrations/sessions', (_req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) return res.json([]);
      res.json(agent.getAllSessions());
    } catch (err) {
      res.status(500).json({ error: 'Failed to list sessions', detail: (err as Error).message });
    }
  });

  // ── Subscriptions ─────────────────────────────────────────

  // POST /api/integrations/subscriptions
  router.post('/integrations/subscriptions', (req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, projectId, categories } = req.body ?? {};
      if (!chatId || !projectId) {
        return res.status(400).json({ error: 'chatId and projectId are required' });
      }

      agent.getBridge().subscribe(chatId, projectId, categories ?? []);
      res.status(201).json({ chatId, projectId, categories: categories ?? [] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create subscription', detail: (err as Error).message });
    }
  });

  // DELETE /api/integrations/subscriptions
  router.delete('/integrations/subscriptions', (req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, projectId } = req.body ?? {};
      if (!chatId || !projectId) {
        return res.status(400).json({ error: 'chatId and projectId are required' });
      }

      agent.getBridge().unsubscribe(chatId, projectId);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove subscription', detail: (err as Error).message });
    }
  });

  // GET /api/integrations/subscriptions
  router.get('/integrations/subscriptions', (_req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) return res.json([]);
      res.json(agent.getBridge().getAllSubscriptions());
    } catch (err) {
      res.status(500).json({ error: 'Failed to list subscriptions', detail: (err as Error).message });
    }
  });

  // ── Send Test Message ─────────────────────────────────────

  // POST /api/integrations/test-message
  router.post('/integrations/test-message', async (req, res) => {
    try {
      const agent = ctx.integrationAgent;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { platform, chatId, text } = req.body ?? {};
      if (!platform || !chatId || !text) {
        return res.status(400).json({ error: 'platform, chatId, and text are required' });
      }

      const adapter = agent.getAdapter(platform);
      if (!adapter) {
        return res.status(404).json({ error: `No adapter found for platform: ${platform}` });
      }

      await adapter.sendMessage({ platform, chatId, text });
      res.json({ sent: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to send test message', detail: (err as Error).message });
    }
  });

  return router;
}
