import { Router } from 'express';
import type { AppContext } from './context.js';
import {
  NotificationService,
  type TelegramChannelConfig,
} from '../coordination/alerts/NotificationService.js';
import { logger } from '../utils/logger.js';

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

  return router;
}
