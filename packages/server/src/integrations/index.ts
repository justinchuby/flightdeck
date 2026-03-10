// packages/server/src/integrations/index.ts
// Barrel export for the integrations module.

export { IntegrationRouter } from './IntegrationRouter.js';
export { TelegramAdapter } from './TelegramAdapter.js';
export { NotificationBatcher } from './NotificationBatcher.js';
export type {
  MessagingPlatform,
  InboundMessage,
  OutboundMessage,
  ChatSession,
  NotificationEvent,
  NotificationCategory,
  TelegramConfig,
  MessagingAdapter,
} from './types.js';
