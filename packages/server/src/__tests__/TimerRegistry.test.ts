import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimerRegistry } from '../coordination/scheduling/TimerRegistry.js';
import type { Timer } from '../coordination/scheduling/TimerRegistry.js';
import { createTestTimerDb } from './helpers/createTestTimerDb.js';

describe('TimerRegistry', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry(createTestTimerDb());
  });

  afterEach(() => {
    registry.stop();
  });

  describe('create', () => {
    it('creates a timer and returns it', () => {
      const timer = registry.create('agent-1', {
        label: 'check-build',
        message: 'Check if the build passed',
        delaySeconds: 300,
      });

      expect(timer).not.toBeNull();
      expect(timer!.agentId).toBe('agent-1');
      expect(timer!.label).toBe('check-build');
      expect(timer!.message).toBe('Check if the build passed');
      expect(timer!.status).toBe('pending');
      expect(timer!.fireAt).toBeGreaterThan(Date.now());
    });

    it('persists to DB', () => {
      const timer = registry.create('agent-1', {
        label: 'db-test',
        message: 'persisted',
        delaySeconds: 60,
      });

      const all = registry.getAllTimers();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(timer!.id);
    });

    it('returns null when agent exceeds max timers', () => {
      for (let i = 0; i < 20; i++) {
        const result = registry.create('agent-1', {
          label: `timer-${i}`,
          message: 'msg',
          delaySeconds: 600,
        });
        expect(result).not.toBeNull();
      }

      const overflow = registry.create('agent-1', {
        label: 'overflow',
        message: 'msg',
        delaySeconds: 600,
      });
      expect(overflow).toBeNull();
    });

    it('different agents have separate limits', () => {
      for (let i = 0; i < 20; i++) {
        registry.create('agent-1', { label: `t-${i}`, message: 'm', delaySeconds: 600 });
      }

      const agent2Timer = registry.create('agent-2', {
        label: 'agent2-timer',
        message: 'msg',
        delaySeconds: 300,
      });
      expect(agent2Timer).not.toBeNull();
    });

    it('emits timer:created event', () => {
      const created: Timer[] = [];
      registry.on('timer:created', (t: Timer) => created.push(t));
      registry.create('agent-1', { label: 'x', message: 'm', delaySeconds: 60 });
      expect(created).toHaveLength(1);
      expect(created[0].label).toBe('x');
    });
  });

  describe('cancel', () => {
    it('cancels a timer by ID', () => {
      const timer = registry.create('agent-1', {
        label: 'review',
        message: 'Follow up on review',
        delaySeconds: 600,
      })!;

      const cancelled = registry.cancel(timer.id, 'agent-1');
      expect(cancelled).toBe(true);
      expect(registry.getAgentTimers('agent-1')).toHaveLength(0);
    });

    it('marks timer as cancelled in DB', () => {
      const timer = registry.create('agent-1', { label: 'x', message: 'm', delaySeconds: 60 })!;
      registry.cancel(timer.id, 'agent-1');
      const all = registry.getAllTimers();
      expect(all.find(t => t.id === timer.id)!.status).toBe('cancelled');
    });

    it('emits timer:cancelled event', () => {
      const events: Timer[] = [];
      registry.on('timer:cancelled', (t: Timer) => events.push(t));
      const timer = registry.create('agent-1', { label: 'x', message: 'm', delaySeconds: 60 })!;
      registry.cancel(timer.id, 'agent-1');
      expect(events).toHaveLength(1);
    });

    it('returns false for wrong agent', () => {
      const timer = registry.create('agent-1', {
        label: 'review',
        message: 'msg',
        delaySeconds: 600,
      })!;

      expect(registry.cancel(timer.id, 'agent-2')).toBe(false);
      expect(registry.getAgentTimers('agent-1')).toHaveLength(1);
    });

    it('returns false for nonexistent timer', () => {
      expect(registry.cancel('tmr-nonexistent', 'agent-1')).toBe(false);
    });
  });

  describe('getAgentTimers', () => {
    it('returns only pending timers for the agent', () => {
      registry.create('agent-1', { label: 'a', message: 'm', delaySeconds: 600 });
      registry.create('agent-1', { label: 'b', message: 'm', delaySeconds: 300 });
      registry.create('agent-2', { label: 'c', message: 'm', delaySeconds: 600 });

      const agent1Timers = registry.getAgentTimers('agent-1');
      expect(agent1Timers).toHaveLength(2);
      expect(agent1Timers.map(t => t.label).sort()).toEqual(['a', 'b']);
    });

    it('returns empty for unknown agent', () => {
      expect(registry.getAgentTimers('agent-unknown')).toHaveLength(0);
    });
  });

  describe('getAllTimers', () => {
    it('returns all timers across agents (including cancelled/fired)', () => {
      registry.create('agent-1', { label: 'a', message: 'm', delaySeconds: 600 });
      const t2 = registry.create('agent-2', { label: 'b', message: 'm', delaySeconds: 300 })!;
      registry.cancel(t2.id, 'agent-2');

      const all = registry.getAllTimers();
      expect(all).toHaveLength(2);
    });
  });

  describe('timer firing', () => {
    it('emits timer:fired when timer expires', async () => {
      vi.useFakeTimers();

      const fired: Timer[] = [];
      registry.on('timer:fired', (timer: Timer) => fired.push(timer));

      registry.create('agent-1', {
        label: 'quick-check',
        message: 'Time to check',
        delaySeconds: 10,
      });

      registry.start();

      vi.advanceTimersByTime(15_000);

      expect(fired).toHaveLength(1);
      expect(fired[0].label).toBe('quick-check');
      expect(fired[0].message).toBe('Time to check');
      expect(fired[0].agentId).toBe('agent-1');

      // Timer should be marked fired in DB
      const all = registry.getAllTimers();
      expect(all[0].status).toBe('fired');

      vi.useRealTimers();
    });

    it('does not fire cancelled timers', async () => {
      vi.useFakeTimers();

      const fired: Timer[] = [];
      registry.on('timer:fired', (timer: Timer) => fired.push(timer));

      const timer = registry.create('agent-1', {
        label: 'cancelled',
        message: 'Should not fire',
        delaySeconds: 10,
      })!;

      registry.cancel(timer.id, 'agent-1');
      registry.start();

      vi.advanceTimersByTime(15_000);

      expect(fired).toHaveLength(0);

      vi.useRealTimers();
    });

    it('fires multiple timers in order', () => {
      vi.useFakeTimers();

      const fired: string[] = [];
      registry.on('timer:fired', (timer: Timer) => fired.push(timer.label));

      registry.create('agent-1', { label: 'second', message: 'm', delaySeconds: 20 });
      registry.create('agent-1', { label: 'first', message: 'm', delaySeconds: 10 });

      registry.start();

      vi.advanceTimersByTime(11_000);
      expect(fired).toEqual(['first']);

      vi.advanceTimersByTime(10_000);
      expect(fired).toEqual(['first', 'second']);

      vi.useRealTimers();
    });
  });

  describe('clearAgent', () => {
    it('removes all timers for an agent', () => {
      registry.create('agent-1', { label: 'a', message: 'm', delaySeconds: 600 });
      registry.create('agent-1', { label: 'b', message: 'm', delaySeconds: 300 });
      registry.create('agent-2', { label: 'c', message: 'm', delaySeconds: 600 });

      const count = registry.clearAgent('agent-1');
      expect(count).toBe(2);
      expect(registry.getAgentTimers('agent-1')).toHaveLength(0);
      expect(registry.getAgentTimers('agent-2')).toHaveLength(1);
    });

    it('returns 0 for agent with no timers', () => {
      expect(registry.clearAgent('agent-none')).toBe(0);
    });
  });

  describe('persistence', () => {
    it('loadPending restores timers on start', () => {
      const db = createTestTimerDb();
      const reg1 = new TimerRegistry(db);
      reg1.create('agent-1', { label: 'persist-test', message: 'hello', delaySeconds: 600 });
      reg1.stop();

      // New registry using same DB
      const reg2 = new TimerRegistry(db);
      reg2.start();
      expect(reg2.getPendingTimers()).toHaveLength(1);
      expect(reg2.getPendingTimers()[0].label).toBe('persist-test');
      reg2.stop();
    });

    it('repeat timer persists rescheduled fireAt to DB', () => {
      vi.useFakeTimers();

      const db = createTestTimerDb();
      const reg1 = new TimerRegistry(db);
      reg1.create('agent-1', { label: 'recurring', message: 'ping', delaySeconds: 10, repeat: true });

      reg1.start();
      vi.advanceTimersByTime(15_000);

      // Timer should have fired and been rescheduled — stop this registry
      reg1.stop();

      // New registry from same DB should load the rescheduled timer as pending
      const reg2 = new TimerRegistry(db);
      reg2.start();
      const pending = reg2.getPendingTimers();
      expect(pending).toHaveLength(1);
      expect(pending[0].label).toBe('recurring');
      expect(pending[0].status).toBe('pending');
      // fireAt should be in the future (rescheduled), not the original time
      expect(pending[0].fireAt).toBeGreaterThan(Date.now());
      reg2.stop();

      vi.useRealTimers();
    });
  });

  describe('start/stop', () => {
    it('start is idempotent', () => {
      registry.start();
      registry.start(); // no error
      registry.stop();
    });

    it('stop clears the interval', () => {
      vi.useFakeTimers();
      registry.start();

      const fired: Timer[] = [];
      registry.on('timer:fired', (t: Timer) => fired.push(t));

      registry.create('agent-1', { label: 'x', message: 'm', delaySeconds: 10 });
      registry.stop();

      vi.advanceTimersByTime(15_000);
      expect(fired).toHaveLength(0);

      vi.useRealTimers();
    });
  });
});
