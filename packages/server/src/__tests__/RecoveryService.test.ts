import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecoveryService, type RecoveryEvent, type RecoverySettings } from '../coordination/recovery/RecoveryService.js';
import { Database } from '../db/database.js';
import { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import { ActivityLedger } from '../coordination/activity/ActivityLedger.js';
import { DecisionLog } from '../coordination/decisions/DecisionLog.js';

describe('RecoveryService', () => {
  let db: Database;
  let lockRegistry: FileLockRegistry;
  let activityLedger: ActivityLedger;
  let decisionLog: DecisionLog;
  let service: RecoveryService;

  beforeEach(() => {
    db = new Database(':memory:');
    lockRegistry = new FileLockRegistry(db);
    activityLedger = new ActivityLedger(db);
    decisionLog = new DecisionLog(db);
    service = new RecoveryService(db, lockRegistry, activityLedger, decisionLog);
  });

  describe('settings', () => {
    it('returns default settings', () => {
      const settings = service.getSettings();
      expect(settings.autoRestart).toBe(true);
      expect(settings.reviewHandoffs).toBe(false);
      expect(settings.maxAttempts).toBe(3);
    });

    it('updates settings', () => {
      const updated = service.updateSettings({ autoRestart: false, maxAttempts: 5 });
      expect(updated.autoRestart).toBe(false);
      expect(updated.maxAttempts).toBe(5);
    });

    it('clamps maxAttempts between 1 and 10', () => {
      expect(service.updateSettings({ maxAttempts: 0 }).maxAttempts).toBe(1);
      expect(service.updateSettings({ maxAttempts: 20 }).maxAttempts).toBe(10);
    });

    it('persists settings across instances', () => {
      service.updateSettings({ reviewHandoffs: true });
      const service2 = new RecoveryService(db, lockRegistry, activityLedger, decisionLog);
      expect(service2.getSettings().reviewHandoffs).toBe(true);
    });
  });

  describe('recovery lifecycle', () => {
    it('starts a recovery event', () => {
      const event = service.startRecovery({
        originalAgentId: 'agent-123',
        trigger: 'crash',
        currentTask: { id: 'task-1', title: 'API refactor', progress: '60% complete' },
        contextUsage: 92,
      })!;
      expect(event.id).toMatch(/^recovery-/);
      expect(event.originalAgentId).toBe('agent-123');
      expect(event.trigger).toBe('crash');
      expect(event.status).toBe('generating_briefing');
      expect(event.briefing).not.toBeNull();
      expect(event.briefing!.narrative).toContain('API refactor');
      expect(event.briefing!.contextUsageAtCrash).toBe(92);
    });

    it('sets awaiting_review when reviewHandoffs is enabled', () => {
      service.updateSettings({ reviewHandoffs: true });
      const event = service.startRecovery({
        originalAgentId: 'agent-123',
        trigger: 'crash',
      });
      expect(event!.status).toBe('awaiting_review');
    });

    it('deduplicates — skips if active recovery exists for same agent', () => {
      const first = service.startRecovery({ originalAgentId: 'agent-1', trigger: 'crash' });
      expect(first).not.toBeNull();
      const duplicate = service.startRecovery({ originalAgentId: 'agent-1', trigger: 'crash' });
      expect(duplicate).toBeNull();
      expect(service.getEvents()).toHaveLength(1);
    });

    it('allows new recovery after previous one completed', () => {
      const first = service.startRecovery({ originalAgentId: 'agent-1', trigger: 'crash' });
      service.approveRecovery(first!.id);
      service.completeRecovery(first!.id);
      const second = service.startRecovery({ originalAgentId: 'agent-1', trigger: 'crash' });
      expect(second).not.toBeNull();
      expect(service.getEvents()).toHaveLength(2);
    });

    it('skips auto-restart when budget is exhausted', () => {
      const event = service.startRecovery({
        originalAgentId: 'agent-1',
        trigger: 'crash',
        budgetExhausted: true,
      });
      expect(event).not.toBeNull();
      expect(event!.status).toBe('failed');
      expect(event!.briefing).toBeNull();
    });

    it('approves recovery and transitions to restarting', () => {
      const event = service.startRecovery({
        originalAgentId: 'agent-123',
        trigger: 'unresponsive',
      })!;
      const approved = service.approveRecovery(event.id);
      expect(approved).not.toBeNull();
      expect(approved!.status).toBe('restarting');
    });

    it('completes recovery', () => {
      const event = service.startRecovery({
        originalAgentId: 'agent-123',
        trigger: 'crash',
      })!;
      service.approveRecovery(event.id);
      const completed = service.completeRecovery(event.id, 'agent-456');
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('recovered');
      expect(completed!.replacementAgentId).toBe('agent-456');
      expect(completed!.recoveredAt).not.toBeNull();
    });

    it('cancels a pending recovery', () => {
      const event = service.startRecovery({
        originalAgentId: 'agent-123',
        trigger: 'manual',
      })!;
      const cancelled = service.cancelRecovery(event.id);
      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('failed');
      expect(cancelled!.failedAt).not.toBeNull();
    });

    it('cannot cancel an already recovered event', () => {
      const event = service.startRecovery({ originalAgentId: 'a', trigger: 'crash' })!;
      service.approveRecovery(event.id);
      service.completeRecovery(event.id);
      expect(service.cancelRecovery(event.id)).toBeNull();
    });

    it('retries on failure up to maxAttempts', () => {
      service.updateSettings({ maxAttempts: 2 });
      const event = service.startRecovery({ originalAgentId: 'a', trigger: 'crash' })!;

      // First failure → retry (attempt 2)
      const retry = service.failRecovery(event.id, 'timeout');
      expect(retry!.status).toBe('generating_briefing');
      expect(retry!.attempts).toBe(2);

      // Second failure → exhausted
      const exhausted = service.failRecovery(event.id, 'timeout again');
      expect(exhausted!.status).toBe('failed');
      expect(exhausted!.failedAt).not.toBeNull();
    });
  });

  describe('briefing', () => {
    it('generates briefing with task and file info', () => {
      lockRegistry.acquire('agent-123', 'Developer', 'src/api.ts');
      const event = service.startRecovery({
        originalAgentId: 'agent-123',
        trigger: 'context_exhaustion',
        currentTask: { id: 't1', title: 'Build API', progress: '80%' },
        contextUsage: 95,
        lastMessages: [
          { role: 'user', content: 'Please build the API' },
          { role: 'assistant', content: 'Working on it...' },
        ],
      })!;

      expect(event.briefing!.narrative).toContain('Build API');
      expect(event.briefing!.narrative).toContain('95%');
      expect(event.briefing!.lastMessages).toHaveLength(2);
      expect(event.preservedFiles).toContain('src/api.ts');
    });

    it('allows editing briefing narrative', () => {
      const event = service.startRecovery({ originalAgentId: 'a', trigger: 'crash' })!;
      const updated = service.updateBriefing(event.id, { narrative: 'Custom briefing text' });
      expect(updated!.briefing!.narrative).toBe('Custom briefing text');
    });

    it('allows toggling briefing sections off', () => {
      const event = service.startRecovery({
        originalAgentId: 'a',
        trigger: 'crash',
        lastMessages: [{ role: 'user', content: 'test' }],
      })!;
      const updated = service.updateBriefing(event.id, {
        sections: { lastMessages: false, discoveries: false },
      });
      expect(updated!.briefing!.lastMessages).toEqual([]);
      expect(updated!.briefing!.discoveries).toEqual([]);
    });

    it('includes active intent rules in briefing', () => {
      decisionLog.addIntentRule('style', 'manual', {
        name: 'Allow style from devs',
        enabled: true,
      });
      const event = service.startRecovery({ originalAgentId: 'a', trigger: 'crash' })!;
      expect(event.briefing!.activeIntentRules).toContain('Allow style from devs');
    });
  });

  describe('metrics', () => {
    it('returns zeroed metrics when no events', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalCrashes).toBe(0);
      expect(metrics.totalRecoveries).toBe(0);
      expect(metrics.successRate).toBe(0);
      expect(metrics.avgRecoveryTimeMs).toBe(0);
    });

    it('tracks success rate', () => {
      // Create 2 successful recoveries
      for (let i = 0; i < 2; i++) {
        const e = service.startRecovery({ originalAgentId: `a${i}`, trigger: 'crash' })!;
        service.approveRecovery(e.id);
        service.completeRecovery(e.id);
      }
      // Create 1 failed recovery
      const failed = service.startRecovery({ originalAgentId: 'b', trigger: 'crash' })!;
      service.updateSettings({ maxAttempts: 1 });
      service.failRecovery(failed.id, 'nope');

      const metrics = service.getMetrics();
      expect(metrics.totalCrashes).toBe(3);
      expect(metrics.totalRecoveries).toBe(2);
      expect(metrics.successRate).toBe(67); // 2/3
    });

    it('tracks trigger distribution', () => {
      service.startRecovery({ originalAgentId: 'a', trigger: 'crash' });
      service.startRecovery({ originalAgentId: 'b', trigger: 'crash' });
      service.startRecovery({ originalAgentId: 'c', trigger: 'context_exhaustion' });

      const metrics = service.getMetrics();
      const crashes = metrics.recoveryEvents.find(e => e.trigger === 'crash');
      const exhaustions = metrics.recoveryEvents.find(e => e.trigger === 'context_exhaustion');
      expect(crashes!.count).toBe(2);
      expect(exhaustions!.count).toBe(1);
    });
  });

  describe('events', () => {
    it('emits recovery:started on startRecovery', () => {
      const handler = vi.fn();
      service.on('recovery:started', handler);
      service.startRecovery({ originalAgentId: 'a', trigger: 'crash' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a', trigger: 'crash' }));
    });

    it('emits recovery:completed on completeRecovery', () => {
      const handler = vi.fn();
      service.on('recovery:completed', handler);
      const event = service.startRecovery({ originalAgentId: 'a', trigger: 'crash' })!;
      service.approveRecovery(event.id);
      service.completeRecovery(event.id, 'b');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        originalAgentId: 'a',
        replacementAgentId: 'b',
      }));
    });

    it('emits recovery:failed on exhausted retries', () => {
      const handler = vi.fn();
      service.on('recovery:failed', handler);
      service.updateSettings({ maxAttempts: 1 });
      const event = service.startRecovery({ originalAgentId: 'a', trigger: 'crash' })!;
      service.failRecovery(event.id, 'timeout');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
    });
  });

  describe('persistence', () => {
    it('persists events across instances', () => {
      service.startRecovery({ originalAgentId: 'a', trigger: 'crash' });
      const service2 = new RecoveryService(db, lockRegistry, activityLedger, decisionLog);
      expect(service2.getEvents()).toHaveLength(1);
    });

    it('caps events at 100', () => {
      for (let i = 0; i < 105; i++) {
        service.startRecovery({ originalAgentId: `agent-${i}`, trigger: 'crash' });
      }
      const service2 = new RecoveryService(db, lockRegistry, activityLedger, decisionLog);
      expect(service2.getEvents().length).toBeLessThanOrEqual(100);
    });
  });
});
