// packages/web/src/components/Settings/telegram/types.ts
// Shared types for the Telegram settings wizard and dashboard.

export interface TelegramStatus {
  enabled: boolean;
  adapters: Array<{ platform: string; running: boolean }>;
  sessions: TelegramSession[];
  pendingNotifications: number;
  subscriptions: number;
}

export interface TelegramSession {
  chatId: string;
  platform: string;
  projectId: string;
  boundBy: string;
  expiresAt: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedChatIds: string[];
  rateLimitPerMinute: number;
  notifications?: {
    enabledCategories?: NotificationCategory[];
    quietHours?: QuietHours | null;
  };
}

export interface BotInfo {
  id: number;
  username: string;
  firstName: string;
}

export interface ValidateTokenResponse {
  valid: boolean;
  bot?: BotInfo;
  error?: string;
}

export interface TestResult {
  sent: boolean;
  error?: string;
}

export type NotificationCategory =
  | 'agent_spawned'
  | 'agent_completed'
  | 'task_completed'
  | 'decision_recorded'
  | 'decision_needs_approval'
  | 'agent_crashed'
  | 'system_alert';

export interface QuietHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

export interface NotificationCategoryInfo {
  id: NotificationCategory;
  label: string;
  icon: string;
  critical: boolean;
}

export const NOTIFICATION_CATEGORIES: NotificationCategoryInfo[] = [
  { id: 'decision_needs_approval', label: 'Decisions needing approval', icon: '🔔', critical: true },
  { id: 'agent_crashed', label: 'Agent crashes', icon: '⚠️', critical: true },
  { id: 'system_alert', label: 'System alerts', icon: '🚨', critical: true },
  { id: 'decision_recorded', label: 'Decisions recorded', icon: '📝', critical: false },
  { id: 'task_completed', label: 'Task completions', icon: '✅', critical: false },
  { id: 'agent_spawned', label: 'Agent spawned', icon: '🤖', critical: false },
  { id: 'agent_completed', label: 'Agent completed', icon: '🏁', critical: false },
];

/** Default enabled categories for new setups. */
export const DEFAULT_ENABLED_CATEGORIES = new Set<NotificationCategory>(
  NOTIFICATION_CATEGORIES.filter(c => c.critical || c.id === 'task_completed' || c.id === 'decision_recorded').map(c => c.id),
);

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startHour: 22,
  endHour: 8,
};

export const DEFAULT_RATE_LIMIT = 20;

/** Step props shared by wizard steps. */
export interface StepProps {
  config: Partial<TelegramConfig>;
  onUpdate: (partial: Partial<TelegramConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}
