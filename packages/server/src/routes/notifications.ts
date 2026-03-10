import { Router } from 'express';
import type { AppContext } from './context.js';
import {
  NotificationService,
  type TelegramChannelConfig,
  type NotifiableEvent,
} from '../coordination/alerts/NotificationService.js';
import { logger } from '../utils/logger.js';
import { parseIntBounded } from '../utils/validation.js';

export function notificationRoutes(ctx: AppContext): Router {
  const { db } = ctx;
  const service = new NotificationService(db, ctx.configStore);
  const router = Router();

  // Wire Telegram delivery: when NotificationService routes an event to a
  // telegram channel, send it through IntegrationRouter → TelegramAdapter.
  service.on('notification:sent', ({ channelId, channelType, event, detail }: {
    channelId: string; channelType: string; event: string; detail: string;
  }) => {
    if (channelType !== 'telegram') return;
    const integrationRouter = ctx.integrationRouter;
    if (!integrationRouter) return;

    const channel = service.getChannels().find(c => c.id === channelId);
    if (!channel) return;

    const cfg = channel.config as TelegramChannelConfig;
    const adapter = integrationRouter.getAdapter('telegram');
    if (!adapter) {
      logger.warn({ module: 'notifications', msg: 'Telegram adapter not available for notification delivery', channelId });
      return;
    }

    adapter.sendMessage({
      platform: 'telegram',
      chatId: cfg.chatId,
      text: `🔔 ${event}: ${detail}`,
    }).catch(err => {
      logger.warn({ module: 'notifications', msg: 'Failed to deliver Telegram notification', channelId, error: (err as Error).message });
    });
  });

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
      const validTypes = ['desktop', 'slack', 'discord', 'telegram'];
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

  // ── Composite Settings (used by NotificationPreferencesPanel) ──
  //
  // NOTE: Notification routing respects user preferences and quiet hours,
  // but does NOT check oversight level. External channels (Telegram/Slack)
  // represent explicit opt-ins and fire regardless of Trust Dial setting.
  // Oversight level only gates client-side in-app toast notifications
  // (see settingsStore.ts → shouldNotify()).

  // GET /api/notifications/routing — returns event→channelType routing matrix
  router.get('/notifications/routing', (_req, res) => {
    try {
      const preferences = service.getPreferences();
      const channels = service.getChannels();

      // Build routing matrix: event → channel types (not IDs)
      const routing: Record<string, string[]> = {};
      for (const pref of preferences) {
        if (!pref.enabled) {
          routing[pref.event] = [];
          continue;
        }
        const channelTypes: string[] = [];
        for (const channelId of pref.channels) {
          const channel = channels.find(c => c.id === channelId);
          if (channel) channelTypes.push(channel.type);
        }
        routing[pref.event] = [...new Set(channelTypes)];
      }

      res.json({ routing, preset: 'conservative' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to get routing', detail: (err as Error).message });
    }
  });

  // PUT /api/notifications/settings — composite save for the settings panel
  // Accepts { channels, routing, preset, quietHours } and delegates to service methods
  router.put('/notifications/settings', (req, res) => {
    try {
      const { channels: channelUpdates, routing, quietHours } = req.body ?? {};

      // 1. Update channel enabled states
      if (Array.isArray(channelUpdates)) {
        for (const ch of channelUpdates) {
          if (ch.id && ch.enabled !== undefined) {
            service.updateChannel(ch.id, { enabled: ch.enabled });
          }
        }
      }

      // 2. Convert routing matrix (event→channelTypes) to preferences (event→channelIds)
      if (routing && typeof routing === 'object') {
        const allChannels = service.getChannels();
        const existingPrefs = service.getPreferences();
        const updates = Object.entries(routing).map(([event, channelTypes]) => {
          const types = channelTypes as string[];
          const channelIds = allChannels
            .filter(c => types.includes(c.type) && c.enabled)
            .map(c => c.id);
          const existing = existingPrefs.find(p => p.event === event);
          return {
            event: event as NotifiableEvent,
            tier: existing?.tier ?? 'summon' as const,
            channels: channelIds,
            enabled: channelIds.length > 0,
          };
        });
        service.updatePreferences(updates);
      }

      // 3. Save quiet hours
      if (quietHours !== undefined) {
        if (quietHours && quietHours.start && quietHours.end) {
          service.setQuietHours({
            enabled: true,
            start: quietHours.start,
            end: quietHours.end,
            timezone: quietHours.timezone ?? 'UTC',
          });
        } else {
          service.setQuietHours({
            enabled: false,
            start: '22:00',
            end: '08:00',
            timezone: 'UTC',
          });
        }
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save settings', detail: (err as Error).message });
    }
  });

  // ── Notification Log ──────────────────────────────────────────

  // GET /api/notifications/log
  router.get('/notifications/log', (req, res) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      const page = parseIntBounded(req.query.page, 1, 10000, 1);
      const limit = parseIntBounded(req.query.limit, 1, 200, 50);
      res.json(service.getLog(sessionId, page, limit));
    } catch (err) {
      res.status(500).json({ error: 'Failed to get notification log', detail: (err as Error).message });
    }
  });

  return router;
}
