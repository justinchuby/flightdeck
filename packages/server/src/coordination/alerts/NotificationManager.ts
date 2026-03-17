import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

export type NotificationChannel = 'websocket' | 'webhook' | 'agent-message';
type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';
export type NotificationCategory = 'task' | 'build' | 'decision' | 'alert' | 'communication' | 'system';

export interface NotificationPreference {
  userId: string;
  channels: NotificationChannel[];
  minPriority: NotificationPriority;
  mutedCategories: NotificationCategory[];
  quietHoursStart?: string; // HH:MM
  quietHoursEnd?: string;   // HH:MM
}

export interface Notification {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  source: string;
  createdAt: number;
  read: boolean;
  actionUrl?: string;
}

const PRIORITY_ORDER: NotificationPriority[] = ['low', 'medium', 'high', 'urgent'];

export class NotificationManager extends EventEmitter {
  private preferences: Map<string, NotificationPreference> = new Map();
  private notifications: Notification[] = [];
  private maxNotifications: number;

  constructor(maxNotifications: number = 500) {
    super();
    this.maxNotifications = maxNotifications;
  }

  setPreferences(userId: string, prefs: Partial<NotificationPreference>): NotificationPreference {
    const existing = this.preferences.get(userId) ?? {
      userId,
      channels: ['websocket'] as NotificationChannel[],
      minPriority: 'low' as NotificationPriority,
      mutedCategories: [] as NotificationCategory[],
    };
    const updated: NotificationPreference = { ...existing, ...prefs, userId };
    this.preferences.set(userId, updated);
    logger.debug('notification', `Preferences updated for user ${userId}`);
    return updated;
  }

  getPreferences(userId: string): NotificationPreference | undefined {
    return this.preferences.get(userId);
  }

  /** Send a notification, storing it and emitting an event. */
  notify(notification: Omit<Notification, 'id' | 'createdAt' | 'read'>): Notification {
    const full: Notification = {
      ...notification,
      id: `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      createdAt: Date.now(),
      read: false,
    };

    this.notifications.push(full);
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(-this.maxNotifications);
    }

    logger.debug('notification', `[${full.priority}] ${full.title}`, { category: full.category, source: full.source });
    this.emit('notification', full);
    return full;
  }

  /** Check if a notification should be delivered to a user based on their preferences. */
  shouldDeliver(notification: Notification, userId: string): boolean {
    const prefs = this.preferences.get(userId);
    if (!prefs) return true; // No preferences set → deliver everything

    // Check muted categories
    if (prefs.mutedCategories.includes(notification.category)) return false;

    // Check minimum priority threshold
    const minIdx = PRIORITY_ORDER.indexOf(prefs.minPriority);
    const notifIdx = PRIORITY_ORDER.indexOf(notification.priority);
    if (notifIdx < minIdx) return false;

    // Check quiet hours (urgent notifications always break through)
    if (prefs.quietHoursStart && prefs.quietHoursEnd && notification.priority !== 'urgent') {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      if (currentTime >= prefs.quietHoursStart && currentTime <= prefs.quietHoursEnd) return false;
    }

    return true;
  }

  markRead(id: string): boolean {
    const notif = this.notifications.find(n => n.id === id);
    if (!notif) return false;
    notif.read = true;
    return true;
  }

  markAllRead(): void {
    for (const n of this.notifications) n.read = true;
  }

  getNotifications(opts?: {
    unreadOnly?: boolean;
    category?: NotificationCategory;
    limit?: number;
  }): Notification[] {
    let results = [...this.notifications];
    if (opts?.unreadOnly) results = results.filter(n => !n.read);
    if (opts?.category) results = results.filter(n => n.category === opts.category);
    results.sort((a, b) => b.createdAt - a.createdAt);
    return results.slice(0, opts?.limit ?? 100);
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }
}
