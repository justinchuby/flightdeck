import { EventEmitter } from 'events';
import type { Database } from '../../db/database.js';
import type { ConfigStore } from '../../config/ConfigStore.js';
import { logger } from '../../utils/logger.js';
import crypto from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────

type ChannelType = 'desktop' | 'slack' | 'discord' | 'telegram';
type NotificationTier = 'interrupt' | 'summon';
export type NotifiableEvent =
  | 'decision_pending'
  | 'agent_crashed'
  | 'agent_recovered'
  | 'session_completed'
  | 'task_completed'
  | 'context_critical';

interface DesktopConfig {
  sound: boolean;
  showPreview: boolean;
}

interface SlackConfig {
  webhookUrl: string;
  channel: string;
  mentionOnInterrupt: boolean;
  threadPerSession: boolean;
}

interface DiscordConfig {
  webhookUrl: string;
  threadPerSession: boolean;
}

export interface TelegramChannelConfig {
  /** Chat ID to deliver notifications to (must have an active session). */
  chatId: string;
}

export type ChannelConfig = DesktopConfig | SlackConfig | DiscordConfig | TelegramChannelConfig;

export interface NotificationChannel {
  id: string;
  type: ChannelType;
  enabled: boolean;
  config: ChannelConfig;
  tiers: NotificationTier[];
  createdAt: string;
}

export interface NotificationPreference {
  event: NotifiableEvent;
  tier: NotificationTier;
  channels: string[];
  enabled: boolean;
}

interface QuietHoursConfig {
  enabled: boolean;
  start: string;   // "22:00"
  end: string;     // "08:00"
  timezone: string; // "America/New_York"
}

interface NotificationLogEntry {
  id: string;
  event: NotifiableEvent;
  channelId: string;
  channelType: ChannelType;
  sessionId: string;
  status: 'sent' | 'failed' | 'suppressed';
  detail: string;
  timestamp: string;
}

const CHANNELS_KEY = 'notification_channels';
const PREFERENCES_KEY = 'notification_preferences';
const QUIET_HOURS_KEY = 'notification_quiet_hours';
const LOG_KEY = 'notification_log';

const ALL_EVENTS: NotifiableEvent[] = [
  'decision_pending', 'agent_crashed', 'agent_recovered',
  'session_completed', 'task_completed', 'context_critical',
];

const DEFAULT_PREFERENCES: NotificationPreference[] = ALL_EVENTS.map(event => ({
  event,
  tier: ['agent_crashed'].includes(event) ? 'interrupt' : 'summon',
  channels: [],
  enabled: false,
}));

// ── NotificationService ───────────────────────────────────────────

export class NotificationService extends EventEmitter {
  private channels: NotificationChannel[] = [];
  private preferences: NotificationPreference[] = [];
  private quietHours: QuietHoursConfig | null = null;
  private log: NotificationLogEntry[] = [];

  constructor(private db: Database, private configStore?: ConfigStore) {
    super();
    this.loadAll();
  }

  // ── Channels ──────────────────────────────────────────────────

  getChannels(): NotificationChannel[] {
    return this.channels.map(ch => ({
      ...ch,
      config: this.maskSensitiveConfig(ch),
    }));
  }

  getChannel(id: string): NotificationChannel | undefined {
    return this.channels.find(c => c.id === id);
  }

  createChannel(type: ChannelType, config: ChannelConfig, tiers?: NotificationTier[]): NotificationChannel {
    const id = `channel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel: NotificationChannel = {
      id,
      type,
      enabled: true,
      config,
      tiers: tiers ?? ['interrupt', 'summon'],
      createdAt: new Date().toISOString(),
    };
    this.channels.push(channel);
    this.saveChannels();
    logger.info('notifications', `Channel created: ${type} (${id.slice(0, 12)})`);
    return channel;
  }

  updateChannel(id: string, updates: Partial<Pick<NotificationChannel, 'enabled' | 'config' | 'tiers'>>): NotificationChannel | null {
    const channel = this.channels.find(c => c.id === id);
    if (!channel) return null;
    if (updates.enabled !== undefined) channel.enabled = updates.enabled;
    if (updates.config !== undefined) channel.config = updates.config;
    if (updates.tiers !== undefined) channel.tiers = updates.tiers;
    this.saveChannels();
    return channel;
  }

  deleteChannel(id: string): boolean {
    const idx = this.channels.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this.channels.splice(idx, 1);
    // Remove from preferences
    for (const pref of this.preferences) {
      pref.channels = pref.channels.filter(cid => cid !== id);
    }
    this.saveChannels();
    this.savePreferences();
    return true;
  }

  testChannel(id: string): { success: boolean; error?: string } {
    const channel = this.channels.find(c => c.id === id);
    if (!channel) return { success: false, error: 'Channel not found' };
    if (!channel.enabled) return { success: false, error: 'Channel is disabled' };

    // Validate config based on type
    switch (channel.type) {
      case 'desktop':
        return { success: true };
      case 'slack':
      case 'discord': {
        const cfg = channel.config as SlackConfig | DiscordConfig;
        if (!cfg.webhookUrl || !cfg.webhookUrl.startsWith('https://')) {
          return { success: false, error: 'Invalid webhook URL' };
        }
        return { success: true };
      }
      case 'telegram': {
        const cfg = channel.config as TelegramChannelConfig;
        if (!cfg.chatId) {
          return { success: false, error: 'chatId is required for Telegram channel' };
        }
        return { success: true };
      }
      default:
        return { success: false, error: 'Unknown channel type' };
    }
  }

  // ── Preferences ───────────────────────────────────────────────

  getPreferences(): NotificationPreference[] {
    return [...this.preferences];
  }

  updatePreferences(updates: NotificationPreference[]): NotificationPreference[] {
    for (const update of updates) {
      const existing = this.preferences.find(p => p.event === update.event);
      if (existing) {
        existing.tier = update.tier;
        existing.channels = update.channels;
        existing.enabled = update.enabled;
      } else {
        this.preferences.push(update);
      }
    }
    this.savePreferences();
    return [...this.preferences];
  }

  // ── Quiet Hours ───────────────────────────────────────────────

  getQuietHours(): QuietHoursConfig | null {
    return this.quietHours ? { ...this.quietHours } : null;
  }

  setQuietHours(config: QuietHoursConfig): QuietHoursConfig {
    this.quietHours = { ...config };
    if (this.configStore) {
      this.configStore.writePartial({
        notifications: { ...this.configStore.current.notifications, quietHours: this.quietHours },
      }).catch(err => {
        logger.warn({ module: 'notifications', msg: 'Failed to save quiet hours', err: (err as Error).message });
      });
    } else {
      this.db.setSetting(QUIET_HOURS_KEY, JSON.stringify(this.quietHours));
    }
    return this.quietHours;
  }

  isInQuietHours(): boolean {
    if (!this.quietHours?.enabled) return false;
    // Simple time-range check (ignores timezone for V1 — server-local time)
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = this.quietHours.start.split(':').map(Number);
    const [endH, endM] = this.quietHours.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes < endMinutes) {
      // Same day: e.g., 09:00-17:00
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    // Overnight: e.g., 22:00-08:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // ── Event Routing ─────────────────────────────────────────────

  /** Route a notification event to configured channels */
  routeEvent(event: NotifiableEvent, sessionId: string, detail: string): NotificationLogEntry[] {
    const pref = this.preferences.find(p => p.event === event);
    if (!pref?.enabled) return [];

    const entries: NotificationLogEntry[] = [];
    const suppressedByQuietHours = this.isInQuietHours();

    for (const channelId of pref.channels) {
      const channel = this.channels.find(c => c.id === channelId);
      if (!channel?.enabled) continue;
      if (!channel.tiers.includes(pref.tier)) continue;

      const entry: NotificationLogEntry = {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        event,
        channelId,
        channelType: channel.type,
        sessionId,
        status: suppressedByQuietHours ? 'suppressed' : 'sent',
        detail: suppressedByQuietHours ? 'Suppressed (quiet hours)' : detail,
        timestamp: new Date().toISOString(),
      };

      entries.push(entry);
      this.log.push(entry);

      if (!suppressedByQuietHours) {
        this.emit('notification:sent', { event, channelId, channelType: channel.type, detail });
      }
    }

    this.saveLog();
    return entries;
  }

  /** Generate HMAC signature for webhook payload */
  signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  // ── Notification Log ──────────────────────────────────────────

  getLog(sessionId?: string, page = 1, limit = 50): NotificationLogEntry[] {
    let filtered = [...this.log];
    if (sessionId) {
      filtered = filtered.filter(e => e.sessionId === sessionId);
    }
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const start = (page - 1) * limit;
    return filtered.slice(start, start + limit);
  }

  // ── Private: Config masking ───────────────────────────────────

  private maskSensitiveConfig(channel: NotificationChannel): ChannelConfig {
    const config = { ...channel.config };
    if (channel.type === 'slack' || channel.type === 'discord') {
      const cfg = config as SlackConfig | DiscordConfig;
      if (cfg.webhookUrl) {
        cfg.webhookUrl = cfg.webhookUrl.slice(0, 30) + '...****';
      }
    }
    return config;
  }

  // ── Persistence ───────────────────────────────────────────────

  private loadAll(): void {
    if (this.configStore) {
      this.channels = this.configStore.current.notifications.channels as unknown as NotificationChannel[];
      this.preferences = this.configStore.current.notifications.preferences as unknown as NotificationPreference[];
      const qh = this.configStore.current.notifications.quietHours;
      this.quietHours = qh.enabled ? { ...qh } : null;
    } else {
      try {
        const rawCh = this.db.getSetting(CHANNELS_KEY);
        if (rawCh) this.channels = JSON.parse(rawCh);
      } catch { this.channels = []; }

      try {
        const rawPr = this.db.getSetting(PREFERENCES_KEY);
        if (rawPr) this.preferences = JSON.parse(rawPr);
        else this.preferences = [...DEFAULT_PREFERENCES];
      } catch { this.preferences = [...DEFAULT_PREFERENCES]; }

      try {
        const rawQh = this.db.getSetting(QUIET_HOURS_KEY);
        if (rawQh) this.quietHours = JSON.parse(rawQh);
      } catch { this.quietHours = null; }
    }

    // Log is always from DB (runtime audit data)
    try {
      const rawLog = this.db.getSetting(LOG_KEY);
      if (rawLog) this.log = JSON.parse(rawLog);
    } catch { this.log = []; }
  }

  private saveChannels(): void {
    if (this.configStore) {
      this.configStore.writePartial({
        notifications: { ...this.configStore.current.notifications, channels: this.channels },
      }).catch(err => {
        logger.warn({ module: 'notifications', msg: 'Failed to save channels', err: (err as Error).message });
      });
      return;
    }
    this.db.setSetting(CHANNELS_KEY, JSON.stringify(this.channels));
  }

  private savePreferences(): void {
    if (this.configStore) {
      this.configStore.writePartial({
        notifications: { ...this.configStore.current.notifications, preferences: this.preferences },
      }).catch(err => {
        logger.warn({ module: 'notifications', msg: 'Failed to save preferences', err: (err as Error).message });
      });
      return;
    }
    this.db.setSetting(PREFERENCES_KEY, JSON.stringify(this.preferences));
  }

  private saveLog(): void {
    if (this.log.length > 500) this.log = this.log.slice(-500);
    this.db.setSetting(LOG_KEY, JSON.stringify(this.log));
  }
}
