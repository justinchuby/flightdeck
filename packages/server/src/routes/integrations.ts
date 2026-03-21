// packages/server/src/routes/integrations.ts
// REST endpoints for managing messaging integrations.

import { Router } from 'express';
import type { AppContext } from './context.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { RateLimitError } from '../integrations/IntegrationRouter.js';

const integrationLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'Too many integration requests' });

export function integrationRoutes(ctx: AppContext): Router {
  const router = Router();

  // Apply rate limiting to all integration routes
  router.use('/integrations', integrationLimiter);

  // ── Status ────────────────────────────────────────────────

  // GET /api/integrations/status
  router.get('/integrations/status', (_req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.json({ enabled: false, adapters: [], sessions: [] });
      }

      const telegram = agent.getAdapter('telegram');
      const adapters = [];
      if (telegram) {
        adapters.push({
          platform: 'telegram',
          running: telegram.isRunning(),
        });
      }

      const sessions = agent.getAllSessions();
      const batcher = agent.getBatcher();

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
        pendingNotifications: batcher.pendingCount(),
        subscriptions: batcher.getAllSubscriptions().length,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get integration status', detail: (err as Error).message });
    }
  });

  // ── Session Management (challenge-response flow, B-1/C-2) ──

  // POST /api/integrations/sessions — initiates a challenge
  router.post('/integrations/sessions', async (req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, platform, projectId, boundBy } = req.body ?? {};
      if (!chatId || !platform || !projectId) {
        return res.status(400).json({ error: 'chatId, platform, and projectId are required' });
      }

      // Validate adapter exists for the requested platform
      const adapter = agent.getAdapter(platform);
      if (!adapter) {
        return res.status(404).json({ error: `No adapter found for platform: ${platform}` });
      }

      // Issue challenge — sends verification code to the chat
      const challenge = await agent.createChallenge(chatId, platform, projectId, boundBy ?? 'api');
      res.status(202).json({
        status: 'challenge_sent',
        chatId: challenge.chatId,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        message: 'A verification code has been sent to the chat. POST to /integrations/sessions/verify with the code.',
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create session challenge', detail: (err as Error).message });
    }
  });

  // POST /api/integrations/sessions/verify — completes the challenge
  router.post('/integrations/sessions/verify', (req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, code } = req.body ?? {};
      if (!chatId || !code) {
        return res.status(400).json({ error: 'chatId and code are required' });
      }

      const session = agent.verifyChallenge(chatId, String(code));
      if (!session) {
        return res.status(403).json({ error: 'Invalid or expired verification code' });
      }

      res.status(201).json(session);
    } catch (err: unknown) {
      if (err instanceof RateLimitError) {
        return res.status(429).json({ error: err.message });
      }
      res.status(500).json({ error: (err as Error).message || 'Failed to verify session' });
    }
  });

  // GET /api/integrations/sessions
  router.get('/integrations/sessions', (_req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) return res.json([]);
      res.json(agent.getAllSessions());
    } catch (err) {
      res.status(500).json({ error: 'Failed to list sessions', detail: (err as Error).message });
    }
  });

  // DELETE /api/integrations/sessions/:chatId — revoke a session binding
  router.delete('/integrations/sessions/:chatId', (_req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId } = _req.params;
      if (!chatId) {
        return res.status(400).json({ error: 'chatId is required' });
      }

      const removed = agent.removeSession(chatId);
      if (!removed) {
        return res.status(404).json({ error: 'No active session found for this chatId' });
      }

      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'Failed to revoke session', detail: (err as Error).message });
    }
  });

  // ── Subscriptions ─────────────────────────────────────────

  // POST /api/integrations/subscriptions
  router.post('/integrations/subscriptions', (req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, projectId, categories } = req.body ?? {};
      if (!chatId || !projectId) {
        return res.status(400).json({ error: 'chatId and projectId are required' });
      }

      // Verify an active session exists for this chat+project before subscribing
      const sessions = agent.getAllSessions();
      const hasSession = sessions.some(s => s.chatId === chatId && s.projectId === projectId);
      if (!hasSession) {
        return res.status(403).json({ error: 'No active session for this chatId/projectId. Bind a session first.' });
      }

      agent.getBatcher().subscribe(chatId, projectId, categories ?? []);
      res.status(201).json({ chatId, projectId, categories: categories ?? [] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create subscription', detail: (err as Error).message });
    }
  });

  // DELETE /api/integrations/subscriptions
  router.delete('/integrations/subscriptions', (req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { chatId, projectId } = req.body ?? {};
      if (!chatId || !projectId) {
        return res.status(400).json({ error: 'chatId and projectId are required' });
      }

      agent.getBatcher().unsubscribe(chatId, projectId);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'Failed to remove subscription', detail: (err as Error).message });
    }
  });

  // GET /api/integrations/subscriptions
  router.get('/integrations/subscriptions', (_req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) return res.json([]);
      res.json(agent.getBatcher().getAllSubscriptions());
    } catch (err) {
      res.status(500).json({ error: 'Failed to list subscriptions', detail: (err as Error).message });
    }
  });

  // ── Send Test Message ─────────────────────────────────────

  // POST /api/integrations/test-message
  router.post('/integrations/test-message', async (req, res) => {
    try {
      const agent = ctx.integrationRouter;
      if (!agent) {
        return res.status(503).json({ error: 'Integration agent not available' });
      }

      const { platform, chatId, text } = req.body ?? {};
      if (!platform || !chatId || !text) {
        return res.status(400).json({ error: 'platform, chatId, and text are required' });
      }

      // Verify an active session exists for this chat before sending
      const sessions = agent.getAllSessions();
      const hasSession = sessions.some(s => s.chatId === chatId && s.platform === platform);
      if (!hasSession) {
        return res.status(403).json({ error: 'No active session for this chatId. Bind a session first.' });
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

  // ── Telegram Config ────────────────────────────────────────

  // POST /api/integrations/telegram/validate-token — validate bot token via Telegram getMe API
  router.post('/integrations/telegram/validate-token', async (req, res) => {
    try {
      const { botToken } = req.body ?? {};
      if (!botToken || typeof botToken !== 'string') {
        return res.status(400).json({ valid: false, error: 'botToken is required' });
      }

      // Call Telegram Bot API directly — no adapter needed for validation.
      // Validate token format (digits:alphanumeric) to prevent URL injection.
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
        return res.json({ valid: false, error: 'Invalid token format. Expected format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' });
      }

      const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`);
      const data = await response.json() as {
        ok: boolean;
        result?: { id: number; is_bot: boolean; first_name: string; username?: string };
        description?: string;
      };

      if (!data.ok || !data.result) {
        return res.json({
          valid: false,
          error: data.description ?? 'Invalid bot token',
        });
      }

      res.json({
        valid: true,
        bot: {
          id: data.result.id,
          username: data.result.username ?? '',
          firstName: data.result.first_name,
        },
      });
    } catch (err) {
      res.json({
        valid: false,
        error: `Failed to validate token: ${(err as Error).message}`,
      });
    }
  });

  // PATCH /api/integrations/telegram — update telegram config in flightdeck.config.yaml
  router.patch('/integrations/telegram', async (req, res) => {
    const { configStore } = ctx;
    if (!configStore) {
      return res.status(503).json({ error: 'Config store not available' });
    }

    try {
      const { enabled, botToken, allowedChatIds, rateLimitPerMinute, notifications } = req.body;
      const patch: Record<string, unknown> = {};

      if (enabled !== undefined) patch.enabled = Boolean(enabled);
      if (botToken !== undefined) patch.botToken = String(botToken);
      if (allowedChatIds !== undefined) patch.allowedChatIds = Array.isArray(allowedChatIds) ? allowedChatIds : [];
      if (rateLimitPerMinute !== undefined) patch.rateLimitPerMinute = Number(rateLimitPerMinute);
      if (notifications !== undefined) patch.notifications = notifications;

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      await configStore.writePartial({ telegram: patch });
      res.json({ ok: true, updated: Object.keys(patch) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update telegram config', detail: (err as Error).message });
    }
  });

  return router;
}
