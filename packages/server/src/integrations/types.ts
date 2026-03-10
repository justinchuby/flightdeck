// packages/server/src/integrations/types.ts
// Shared types for the messaging integration layer.

/** Supported messaging platforms. */
export type MessagingPlatform = 'telegram' | 'slack';

/** Inbound message from a user on a messaging platform. */
export interface InboundMessage {
  platform: MessagingPlatform;
  /** Platform-specific chat/channel ID. */
  chatId: string;
  /** Platform-specific user ID. */
  userId: string;
  /** Display name of the sender. */
  displayName: string;
  /** Raw text content of the message. */
  text: string;
  /** Timestamp when the message was received. */
  receivedAt: number;
  /** Platform-specific message ID (for reply threading). */
  messageId?: string;
}

/** Outbound message to send to a messaging platform. */
export interface OutboundMessage {
  platform: MessagingPlatform;
  chatId: string;
  text: string;
  /** Optional parse mode (e.g. 'MarkdownV2', 'HTML'). */
  parseMode?: string;
  /** Reply to a specific message ID (enables threading). */
  replyToMessageId?: string;
}

/** Session binding: maps a messaging chat to a Flightdeck project. */
export interface ChatSession {
  chatId: string;
  platform: MessagingPlatform;
  /** Flightdeck project ID this chat is bound to. */
  projectId: string;
  /** User who bound this chat. */
  boundBy: string;
  /** When the binding was created. */
  createdAt: number;
  /** When the binding expires (1-hour TTL). */
  expiresAt: number;
}

/** Agent event categories that get forwarded to messaging platforms. */
export type NotificationCategory =
  | 'agent_spawned'
  | 'agent_completed'
  | 'task_completed'
  | 'decision_recorded'
  | 'decision_needs_approval'
  | 'agent_crashed'
  | 'system_alert';

/** A notification event ready for formatting and delivery. */
export interface NotificationEvent {
  category: NotificationCategory;
  projectId: string;
  title: string;
  body: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** Configuration for the Telegram integration. */
export interface TelegramConfig {
  enabled: boolean;
  /** Bot token — should come from TELEGRAM_BOT_TOKEN env var. */
  botToken: string;
  /** Chat IDs that are allowed to interact with the bot. */
  allowedChatIds: string[];
  /** Rate limit: max messages per minute per user. */
  rateLimitPerMinute: number;
}

/** Adapter interface — all messaging platforms implement this. */
export interface MessagingAdapter {
  readonly platform: MessagingPlatform;

  /** Start the adapter (connect, begin polling, etc.). */
  start(): Promise<void>;

  /** Stop the adapter gracefully. */
  stop(): Promise<void>;

  /** Whether the adapter is currently running and accepting messages. */
  isRunning(): boolean;

  /** Send a message to a specific chat. */
  sendMessage(message: OutboundMessage): Promise<void>;

  /** Register a handler for inbound messages. */
  onMessage(handler: (message: InboundMessage) => void): void;
}
