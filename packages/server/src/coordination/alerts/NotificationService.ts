import { EventEmitter } from 'events';
import type { Database } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import crypto from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────

export type ChannelType = 'desktop' | 'slack' | 'discord' | 'email' | 'webhook';
export type NotificationTier = 'interrupt' | 'summon';
export type NotifiableEvent =
  | 'decision_pending'
  | 'agent_crashed'
  | 'agent_recovered'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'session_completed'
  | 'task_completed'
  | 'context_critical'
  | 'handoff_ready';

export interface DesktopConfig {
  sound: boolean;
  showPreview: boolean;
}

export interface SlackConfig {
  webhookUrl: string;
  channel: string;
  mentionOnInterrupt: boolean;
  threadPerSession: boolean;
}

export interface DiscordConfig {
  webhookUrl: string;
  threadPerSession: boolean;
}

export interface EmailConfig {
  address: string;
  digestFrequency: 'realtime' | 'hourly' | 'session_end';
}

export interface WebhookConfig {
  url: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  events: NotifiableEvent[];
  secret?: string;
}

export type ChannelConfig = DesktopConfig | SlackConfig | DiscordConfig | EmailConfig | WebhookConfig;

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

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;   // "22:00"
  end: string;     // "08:00"
  timezone: string; // "America/New_York"
}

export interface NotificationLogEntry {
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
  'budget_warning', 'budget_exceeded', 'session_completed',
  'task_completed', 'context_critical', 'handoff_ready',
];

const DEFAULT_PREFERENCES: NotificationPreference[] = ALL_EVENTS.map(event => ({
  event,
  tier: ['agent_crashed', 'budget_exceeded'].includes(event) ? 'interrupt' : 'summon',
  channels: [],
  enabled: true,
}));

// ── NotificationService ───────────────────────────────────────────

export class NotificationService extends EventEmitter {
  private channels: NotificationChannel[] = [];
  private preferences: NotificationPreference[] = [];
  private quietHours: QuietHoursConfig | null = null;
  private log: NotificationLogEntry[] = [];

  constructor(private db: Database) {
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
      case 'email': {
        const cfg = channel.config as EmailConfig;
        if (!cfg.address || !cfg.address.includes('@')) {
          return { success: false, error: 'Invalid email address' };
        }
        return { success: true };
      }
      case 'webhook': {
        const cfg = channel.config as WebhookConfig;
        if (!cfg.url || !cfg.url.startsWith('http')) {
          return { success: false, error: 'Invalid webhook URL' };
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
    this.db.setSetting(QUIET_HOURS_KEY, JSON.stringify(this.quietHours));
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
    if (channel.type === 'webhook') {
      const cfg = config as WebhookConfig;
      if (cfg.secret) cfg.secret = '****';
    }
    return config;
  }

  // ── Persistence ───────────────────────────────────────────────

  private loadAll(): void {
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

    try {
      const rawLog = this.db.getSetting(LOG_KEY);
      if (rawLog) this.log = JSON.parse(rawLog);
    } catch { this.log = []; }
  }

  private saveChannels(): void {
    this.db.setSetting(CHANNELS_KEY, JSON.stringify(this.channels));
  }

  private savePreferences(): void {
    this.db.setSetting(PREFERENCES_KEY, JSON.stringify(this.preferences));
  }

  private saveLog(): void {
    if (this.log.length > 500) this.log = this.log.slice(-500);
    this.db.setSetting(LOG_KEY, JSON.stringify(this.log));
  }
}
