import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../coordination/alerts/NotificationService.js';
import { Database } from '../db/database.js';

describe('NotificationService', () => {
  let db: Database;
  let service: NotificationService;

  beforeEach(() => {
    db = new Database(':memory:');
    service = new NotificationService(db);
  });

  describe('channels', () => {
    it('creates a desktop channel', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      expect(channel.id).toMatch(/^channel-/);
      expect(channel.type).toBe('desktop');
      expect(channel.enabled).toBe(true);
      expect(channel.tiers).toEqual(['interrupt', 'summon']);
    });

    it('creates a slack channel', () => {
      const channel = service.createChannel('slack', {
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        channel: '#flightdeck',
        mentionOnInterrupt: true,
        threadPerSession: true,
      });
      expect(channel.type).toBe('slack');
    });

    it('masks webhook URLs in getChannels()', () => {
      service.createChannel('slack', {
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx',
        channel: '#fd',
        mentionOnInterrupt: false,
        threadPerSession: false,
      });
      const channels = service.getChannels();
      const config = channels[0].config as any;
      expect(config.webhookUrl).toContain('...');
      expect(config.webhookUrl).toContain('****');
    });

    it('updates channel config', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      const updated = service.updateChannel(channel.id, { enabled: false });
      expect(updated!.enabled).toBe(false);
    });

    it('deletes channel and removes from preferences', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      // Add to a preference
      service.updatePreferences([{
        event: 'agent_crashed',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);

      const deleted = service.deleteChannel(channel.id);
      expect(deleted).toBe(true);
      expect(service.getChannels()).toHaveLength(0);
      // Check preference was cleaned
      const prefs = service.getPreferences();
      const crashPref = prefs.find(p => p.event === 'agent_crashed');
      expect(crashPref!.channels).not.toContain(channel.id);
    });

    it('tests desktop channel (always succeeds)', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      expect(service.testChannel(channel.id).success).toBe(true);
    });

    it('tests slack channel with invalid URL', () => {
      const channel = service.createChannel('slack', {
        webhookUrl: 'not-a-url',
        channel: '#fd',
        mentionOnInterrupt: false,
        threadPerSession: false,
      });
      const result = service.testChannel(channel.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid webhook URL');
    });
  });

  describe('preferences', () => {
    it('returns default preferences for all events', () => {
      const prefs = service.getPreferences();
      expect(prefs.length).toBeGreaterThanOrEqual(8);
      expect(prefs.map(p => p.event)).toContain('decision_pending');
      expect(prefs.map(p => p.event)).toContain('agent_crashed');
    });

    it('agent_crashed defaults to interrupt tier', () => {
      const prefs = service.getPreferences();
      const crashPref = prefs.find(p => p.event === 'agent_crashed');
      expect(crashPref!.tier).toBe('interrupt');
    });

    it('updates preferences', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'decision_pending',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);
      const prefs = service.getPreferences();
      const updated = prefs.find(p => p.event === 'decision_pending');
      expect(updated!.channels).toContain(channel.id);
      expect(updated!.tier).toBe('interrupt');
    });
  });

  describe('quiet hours', () => {
    it('returns null by default', () => {
      expect(service.getQuietHours()).toBeNull();
    });

    it('sets and gets quiet hours', () => {
      const config = service.setQuietHours({
        enabled: true,
        start: '22:00',
        end: '08:00',
        timezone: 'America/New_York',
      });
      expect(config.enabled).toBe(true);
      expect(config.start).toBe('22:00');

      const saved = service.getQuietHours();
      expect(saved!.end).toBe('08:00');
    });

    it('persists quiet hours across instances', () => {
      service.setQuietHours({ enabled: true, start: '23:00', end: '07:00', timezone: 'UTC' });
      const service2 = new NotificationService(db);
      expect(service2.getQuietHours()!.start).toBe('23:00');
    });
  });

  describe('event routing', () => {
    it('routes event to configured channels', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'agent_crashed',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);

      const entries = service.routeEvent('agent_crashed', 'session-1', 'Dev-2 crashed');
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('sent');
      expect(entries[0].event).toBe('agent_crashed');
    });

    it('skips disabled preferences', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'task_completed',
        tier: 'summon',
        channels: [channel.id],
        enabled: false,
      }]);

      const entries = service.routeEvent('task_completed', 's1', 'Task done');
      expect(entries).toHaveLength(0);
    });

    it('skips disabled channels', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updateChannel(channel.id, { enabled: false });
      service.updatePreferences([{
        event: 'budget_warning',
        tier: 'summon',
        channels: [channel.id],
        enabled: true,
      }]);

      const entries = service.routeEvent('budget_warning', 's1', 'Budget at 70%');
      expect(entries).toHaveLength(0);
    });

    it('respects tier filtering', () => {
      // Channel only accepts 'interrupt' tier
      const channel = service.createChannel('slack', {
        webhookUrl: 'https://hooks.slack.com/xxx',
        channel: '#fd',
        mentionOnInterrupt: true,
        threadPerSession: false,
      }, ['interrupt']);

      // Event is 'summon' tier → should not route to interrupt-only channel
      service.updatePreferences([{
        event: 'task_completed',
        tier: 'summon',
        channels: [channel.id],
        enabled: true,
      }]);

      const entries = service.routeEvent('task_completed', 's1', 'Done');
      expect(entries).toHaveLength(0);
    });

    it('emits notification:sent event', () => {
      const handler = vi.fn();
      service.on('notification:sent', handler);

      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'agent_recovered',
        tier: 'summon',
        channels: [channel.id],
        enabled: true,
      }]);

      service.routeEvent('agent_recovered', 's1', 'Dev-2 recovered');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        event: 'agent_recovered',
        channelType: 'desktop',
      }));
    });
  });

  describe('notification log', () => {
    it('logs routed events', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'budget_exceeded',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);

      service.routeEvent('budget_exceeded', 'session-1', 'Budget hit 100%');
      const log = service.getLog('session-1');
      expect(log).toHaveLength(1);
      expect(log[0].event).toBe('budget_exceeded');
      expect(log[0].status).toBe('sent');
    });

    it('supports pagination', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'agent_crashed',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);

      for (let i = 0; i < 5; i++) {
        service.routeEvent('agent_crashed', 's1', `Crash ${i}`);
      }

      expect(service.getLog('s1', 1, 2)).toHaveLength(2);
      expect(service.getLog('s1', 2, 2)).toHaveLength(2);
      expect(service.getLog('s1', 3, 2)).toHaveLength(1);
    });
  });

  describe('HMAC signing', () => {
    it('generates consistent HMAC signatures', () => {
      const payload = JSON.stringify({ event: 'agent_crashed', data: 'test' });
      const sig1 = service.signPayload(payload, 'secret-key');
      const sig2 = service.signPayload(payload, 'secret-key');
      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // sha256 hex
    });

    it('different secrets produce different signatures', () => {
      const payload = JSON.stringify({ event: 'test' });
      const sig1 = service.signPayload(payload, 'key-1');
      const sig2 = service.signPayload(payload, 'key-2');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('persistence', () => {
    it('persists channels across instances', () => {
      service.createChannel('desktop', { sound: true, showPreview: true });
      const service2 = new NotificationService(db);
      expect(service2.getChannels()).toHaveLength(1);
    });

    it('persists preferences across instances', () => {
      const channel = service.createChannel('desktop', { sound: true, showPreview: true });
      service.updatePreferences([{
        event: 'agent_crashed',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);
      const service2 = new NotificationService(db);
      const prefs = service2.getPreferences();
      const crashPref = prefs.find(p => p.event === 'agent_crashed');
      expect(crashPref!.channels).toContain(channel.id);
    });
  });

  // ── G-4: Telegram channel support ──────────────────────────

  describe('telegram channel', () => {
    it('creates a telegram channel', () => {
      const channel = service.createChannel('telegram', { chatId: '12345' });
      expect(channel.type).toBe('telegram');
      expect(channel.enabled).toBe(true);
      expect((channel.config as any).chatId).toBe('12345');
    });

    it('validates telegram channel requires chatId', () => {
      const channel = service.createChannel('telegram', { chatId: '' });
      const result = service.testChannel(channel.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('chatId');
    });

    it('validates telegram channel with valid chatId', () => {
      const channel = service.createChannel('telegram', { chatId: '12345' });
      const result = service.testChannel(channel.id);
      expect(result.success).toBe(true);
    });

    it('routes notification events to telegram channel', () => {
      const channel = service.createChannel('telegram', { chatId: '12345' });
      service.updatePreferences([{
        event: 'agent_crashed',
        tier: 'interrupt',
        channels: [channel.id],
        enabled: true,
      }]);

      const sent = vi.fn();
      service.on('notification:sent', sent);

      const entries = service.routeEvent('agent_crashed', 'session-1', 'Agent dev crashed');
      expect(entries).toHaveLength(1);
      expect(entries[0].channelType).toBe('telegram');
      expect(entries[0].status).toBe('sent');
      expect(sent).toHaveBeenCalledWith(
        expect.objectContaining({ channelType: 'telegram', event: 'agent_crashed' }),
      );
    });
  });
});
