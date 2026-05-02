// packages/server/src/routes/integrations.ts
// REST endpoints for managing messaging integrations.

import { Router } from 'express';
import type { AppContext } from './context.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { RateLimitError } from '../integrations/IntegrationRouter.js';
import { badRequest, notFound, forbidden, tooManyRequests, internalError, serviceUnavailable } from '../errors/index.js';

const integrationLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'Too many integration requests' });

export function integrationRoutes(ctx: AppContext): Router {
  const router = Router();

  // Apply rate limiting to all integration routes
  router.use('/integrations', integrationLimiter);

  // ── Status ────────────────────────────────────────────────

  // GET /api/integrations/status
  router.get('/integrations/status', (_req, res) => {
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
  });

  // ── Session Management (challenge-response flow, B-1/C-2) ──

  // POST /api/integrations/sessions — initiates a challenge
  router.post('/integrations/sessions', async (req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) throw serviceUnavailable('Integration agent not available');

    const { chatId, platform, projectId, boundBy } = req.body ?? {};
    if (!chatId || !platform || !projectId) throw badRequest('chatId, platform, and projectId are required');

    // Validate adapter exists for the requested platform
    const adapter = agent.getAdapter(platform);
    if (!adapter) throw notFound(`No adapter found for platform: ${platform}`);

    // Issue challenge — sends verification code to the chat
    const challenge = await agent.createChallenge(chatId, platform, projectId, boundBy ?? 'api');
    res.status(202).json({
      status: 'challenge_sent',
      chatId: challenge.chatId,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      message: 'A verification code has been sent to the chat. POST to /integrations/sessions/verify with the code.',
    });
  });

  // POST /api/integrations/sessions/verify — completes the challenge
  router.post('/integrations/sessions/verify', (req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) throw serviceUnavailable('Integration agent not available');

    const { chatId, code } = req.body ?? {};
    if (!chatId || !code) throw badRequest('chatId and code are required');

    try {
      const session = agent.verifyChallenge(chatId, String(code));
      if (!session) throw forbidden('Invalid or expired verification code');

      res.status(201).json(session);
    } catch (err: unknown) {
      if (err instanceof RateLimitError) {
        throw tooManyRequests(err.message);
      }
      throw err;
    }
  });

  // GET /api/integrations/sessions
  router.get('/integrations/sessions', (_req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) return res.json([]);
    res.json(agent.getAllSessions());
  });

  // ── Subscriptions ─────────────────────────────────────────

  // POST /api/integrations/subscriptions
  router.post('/integrations/subscriptions', (req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) throw serviceUnavailable('Integration agent not available');

    const { chatId, projectId, categories } = req.body ?? {};
    if (!chatId || !projectId) throw badRequest('chatId and projectId are required');

    // Verify an active session exists for this chat+project before subscribing
    const sessions = agent.getAllSessions();
    const hasSession = sessions.some(s => s.chatId === chatId && s.projectId === projectId);
    if (!hasSession) throw forbidden('No active session for this chatId/projectId. Bind a session first.');

    agent.getBatcher().subscribe(chatId, projectId, categories ?? []);
    res.status(201).json({ chatId, projectId, categories: categories ?? [] });
  });

  // DELETE /api/integrations/subscriptions
  router.delete('/integrations/subscriptions', (req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) throw serviceUnavailable('Integration agent not available');

    const { chatId, projectId } = req.body ?? {};
    if (!chatId || !projectId) throw badRequest('chatId and projectId are required');

    agent.getBatcher().unsubscribe(chatId, projectId);
    res.status(204).end();
  });

  // GET /api/integrations/subscriptions
  router.get('/integrations/subscriptions', (_req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) return res.json([]);
    res.json(agent.getBatcher().getAllSubscriptions());
  });

  // ── Send Test Message ─────────────────────────────────────

  // POST /api/integrations/test-message
  router.post('/integrations/test-message', async (req, res) => {
    const agent = ctx.integrationRouter;
    if (!agent) throw serviceUnavailable('Integration agent not available');

    const { platform, chatId, text } = req.body ?? {};
    if (!platform || !chatId || !text) throw badRequest('platform, chatId, and text are required');

    // Verify an active session exists for this chat before sending
    const sessions = agent.getAllSessions();
    const hasSession = sessions.some(s => s.chatId === chatId && s.platform === platform);
    if (!hasSession) throw forbidden('No active session for this chatId. Bind a session first.');

    const adapter = agent.getAdapter(platform);
    if (!adapter) throw notFound(`No adapter found for platform: ${platform}`);

    await adapter.sendMessage({ platform, chatId, text });
    res.json({ sent: true });
  });

  // ── Telegram Config ────────────────────────────────────────

  // PATCH /api/integrations/telegram — update telegram config in flightdeck.config.yaml
  router.patch('/integrations/telegram', async (req, res) => {
    const { configStore } = ctx;
    if (!configStore) throw serviceUnavailable('Config store not available');

    const { enabled, botToken, allowedChatIds, rateLimitPerMinute, notifications } = req.body;
    const patch: Record<string, unknown> = {};

    if (enabled !== undefined) patch.enabled = Boolean(enabled);
    if (botToken !== undefined) patch.botToken = String(botToken);
    if (allowedChatIds !== undefined) patch.allowedChatIds = Array.isArray(allowedChatIds) ? allowedChatIds : [];
    if (rateLimitPerMinute !== undefined) patch.rateLimitPerMinute = Number(rateLimitPerMinute);
    if (notifications !== undefined) patch.notifications = notifications;

    if (Object.keys(patch).length === 0) throw badRequest('No fields to update');

    await configStore.writePartial({ telegram: patch });
    res.json({ ok: true, updated: Object.keys(patch) });
  });

  return router;
}
