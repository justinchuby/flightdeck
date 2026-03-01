/**
 * Additional timer system tests: edge cases, validation, status
 * transitions, persistence, and integration scenarios.
 *
 * Complements TimerRegistry.test.ts (core CRUD) and
 * TimerApi.test.ts (API response shapes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimerRegistry } from '../coordination/TimerRegistry.js';
import type { Timer, TimerInput } from '../coordination/TimerRegistry.js';
import {
  setTimerSchema,
  cancelTimerSchema,
} from '../agents/commands/commandSchemas.js';
import { createTestTimerDb } from './helpers/createTestTimerDb.js';

const createTestDb = createTestTimerDb;

// ── Delay validation (setTimerSchema) ───────────────────────────────

describe('SET_TIMER delay validation', () => {
  const base = { label: 'test', message: 'msg' };

  it('accepts plain number (seconds)', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 300 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(300);
  });

  it('accepts numeric string "300"', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: '300' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(300);
  });

  it('accepts minimum delay of 5 seconds', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(5);
  });

  it('accepts maximum delay of 86400 seconds', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 86400 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(86400);
  });

  it('rejects delay below 5 seconds', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 4 });
    expect(result.success).toBe(false);
  });

  it('rejects delay above 86400 seconds', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 86401 });
    expect(result.success).toBe(false);
  });

  it('rejects negative delay', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: -10 });
    expect(result.success).toBe(false);
  });

  it('rejects NaN string like "hello"', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 'hello' });
    expect(result.success).toBe(false);
  });

  it('string "30m" parses as 1800 seconds (30 minutes)', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: '30m' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(1800);
  });

  it('string "2h" parses as 7200 seconds (2 hours)', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: '2h' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(7200);
  });

  it('accepts optional repeat boolean', () => {
    const result = setTimerSchema.safeParse({ ...base, delay: 60, repeat: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.repeat).toBe(true);
  });

  it('rejects missing label', () => {
    const result = setTimerSchema.safeParse({ delay: 60, message: 'msg' });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = setTimerSchema.safeParse({ label: 'x', delay: 60 });
    expect(result.success).toBe(false);
  });

  it('rejects missing delay', () => {
    const result = setTimerSchema.safeParse({ label: 'x', message: 'msg' });
    expect(result.success).toBe(false);
  });
});

// ── CANCEL_TIMER validation ─────────────────────────────────────────

describe('CANCEL_TIMER validation', () => {
  it('accepts id field', () => {
    const result = cancelTimerSchema.safeParse({ id: 'tmr-123' });
    expect(result.success).toBe(true);
  });

  it('accepts name field', () => {
    const result = cancelTimerSchema.safeParse({ name: 'check-build' });
    expect(result.success).toBe(true);
  });

  it('rejects when both id and name missing', () => {
    const result = cancelTimerSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts both id and name (id takes precedence in handler)', () => {
    const result = cancelTimerSchema.safeParse({ id: 'tmr-123', name: 'backup' });
    expect(result.success).toBe(true);
  });
});

// ── Status transitions ──────────────────────────────────────────────

describe('Timer status transitions', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry(createTestDb());
  });

  afterEach(() => {
    registry.stop();
    vi.useRealTimers();
  });

  it('pending → fired: timer fires and updates DB status', () => {
    vi.useFakeTimers();
    const timer = registry.create('agent-1', {
      label: 'p2f',
      message: 'm',
      delaySeconds: 10,
    })!;
    expect(timer.status).toBe('pending');

    registry.start();
    vi.advanceTimersByTime(15_000);

    const all = registry.getAllTimers();
    expect(all[0].status).toBe('fired');
  });

  it('pending → cancelled: cancel updates DB status', () => {
    const timer = registry.create('agent-1', {
      label: 'p2c',
      message: 'm',
      delaySeconds: 600,
    })!;
    registry.cancel(timer.id, 'agent-1');

    const all = registry.getAllTimers();
    expect(all[0].status).toBe('cancelled');
  });

  it('cancelled timer cannot fire', () => {
    vi.useFakeTimers();
    const fired: Timer[] = [];
    registry.on('timer:fired', (t: Timer) => fired.push(t));

    const timer = registry.create('agent-1', {
      label: 'no-fire',
      message: 'm',
      delaySeconds: 10,
    })!;
    registry.cancel(timer.id, 'agent-1');
    registry.start();
    vi.advanceTimersByTime(15_000);

    expect(fired).toHaveLength(0);
  });

  it('fired timer cannot be cancelled (returns false)', () => {
    vi.useFakeTimers();
    const timer = registry.create('agent-1', {
      label: 'already-fired',
      message: 'm',
      delaySeconds: 10,
    })!;

    registry.start();
    vi.advanceTimersByTime(15_000);

    // Timer has fired — cancel should return false
    const result = registry.cancel(timer.id, 'agent-1');
    expect(result).toBe(false);
  });
});

// ── Persistence across restart ──────────────────────────────────────

describe('Timer persistence across restart', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('timer survives registry restart and fires', () => {
    vi.useFakeTimers();
    const db = createTestDb();
    const reg1 = new TimerRegistry(db);

    reg1.create('agent-1', {
      label: 'survive-restart',
      message: 'Should fire after restart',
      delaySeconds: 30,
    });
    reg1.stop();

    // New registry — simulates server restart
    const reg2 = new TimerRegistry(db);
    const fired: Timer[] = [];
    reg2.on('timer:fired', (t: Timer) => fired.push(t));
    reg2.start();

    expect(reg2.getPendingTimers()).toHaveLength(1);
    expect(reg2.getPendingTimers()[0].label).toBe('survive-restart');

    vi.advanceTimersByTime(35_000);

    expect(fired).toHaveLength(1);
    expect(fired[0].label).toBe('survive-restart');
    reg2.stop();
  });

  it('cancelled timers are NOT loaded after restart', () => {
    const db = createTestDb();
    const reg1 = new TimerRegistry(db);
    const timer = reg1.create('agent-1', {
      label: 'will-cancel',
      message: 'm',
      delaySeconds: 600,
    })!;
    reg1.cancel(timer.id, 'agent-1');
    reg1.stop();

    const reg2 = new TimerRegistry(db);
    reg2.start();
    expect(reg2.getPendingTimers()).toHaveLength(0);
    reg2.stop();
  });

  it('fired timers are NOT loaded after restart', () => {
    vi.useFakeTimers();
    const db = createTestDb();
    const reg1 = new TimerRegistry(db);
    reg1.create('agent-1', { label: 'fire-me', message: 'm', delaySeconds: 5 });
    reg1.start();
    vi.advanceTimersByTime(10_000);
    reg1.stop();

    const reg2 = new TimerRegistry(db);
    reg2.start();
    expect(reg2.getPendingTimers()).toHaveLength(0);
    // But it should still appear in getAllTimers with status=fired
    expect(reg2.getAllTimers().filter(t => t.status === 'fired')).toHaveLength(1);
    reg2.stop();
  });
});

// ── Repeat timers ───────────────────────────────────────────────────

describe('Repeat timer behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('repeat timer fires then reschedules', () => {
    vi.useFakeTimers();
    const registry = new TimerRegistry(createTestDb());
    const fired: Timer[] = [];
    registry.on('timer:fired', (t: Timer) => fired.push({ ...t }));

    registry.create('agent-1', {
      label: 'recurring',
      message: 'check again',
      delaySeconds: 10,
      repeat: true,
    });
    registry.start();

    // First fire
    vi.advanceTimersByTime(15_000);
    expect(fired).toHaveLength(1);

    // Should still be pending (rescheduled)
    expect(registry.getPendingTimers()).toHaveLength(1);

    // Second fire
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveLength(2);

    // Still pending for third cycle
    expect(registry.getPendingTimers()).toHaveLength(1);

    registry.stop();
  });

  it('repeat timer can be cancelled between fires', () => {
    vi.useFakeTimers();
    const registry = new TimerRegistry(createTestDb());
    const fired: Timer[] = [];
    registry.on('timer:fired', (t: Timer) => fired.push(t));

    const timer = registry.create('agent-1', {
      label: 'cancel-me',
      message: 'm',
      delaySeconds: 10,
      repeat: true,
    })!;
    registry.start();

    // First fire
    vi.advanceTimersByTime(15_000);
    expect(fired).toHaveLength(1);

    // Cancel before second fire
    registry.cancel(timer.id, 'agent-1');

    // Advance past second would-be fire
    vi.advanceTimersByTime(15_000);
    expect(fired).toHaveLength(1); // No second fire

    registry.stop();
  });
});

// ── Boundary edge cases ─────────────────────────────────────────────

describe('Timer edge cases', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry(createTestDb());
  });

  afterEach(() => {
    registry.stop();
    vi.useRealTimers();
  });

  it('timer with minimum delay (5s) fires correctly', () => {
    vi.useFakeTimers();
    const fired: Timer[] = [];
    registry.on('timer:fired', (t: Timer) => fired.push(t));

    registry.create('agent-1', { label: 'min-delay', message: 'm', delaySeconds: 5 });
    registry.start();

    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveLength(1);
    expect(fired[0].label).toBe('min-delay');
  });

  it('timer with maximum delay (86400s) is created successfully', () => {
    const timer = registry.create('agent-1', {
      label: 'max-delay',
      message: 'wait 24h',
      delaySeconds: 86400,
    });
    expect(timer).not.toBeNull();
    expect(timer!.delaySeconds).toBe(86400);
  });

  it('rejects negative delay', () => {
    const timer = registry.create('agent-1', {
      label: 'neg',
      message: 'm',
      delaySeconds: -1,
    });
    expect(timer).toBeNull();
  });

  it('rejects NaN delay', () => {
    const timer = registry.create('agent-1', {
      label: 'nan',
      message: 'm',
      delaySeconds: NaN,
    });
    expect(timer).toBeNull();
  });

  it('rejects Infinity delay', () => {
    const timer = registry.create('agent-1', {
      label: 'inf',
      message: 'm',
      delaySeconds: Infinity,
    });
    expect(timer).toBeNull();
  });

  it('rejects delay exceeding 86400', () => {
    const timer = registry.create('agent-1', {
      label: 'too-long',
      message: 'm',
      delaySeconds: 86401,
    });
    expect(timer).toBeNull();
  });

  it('cancelling non-existent timer returns false', () => {
    expect(registry.cancel('tmr-does-not-exist', 'agent-1')).toBe(false);
  });

  it('creating 21st timer is rejected (per-agent limit)', () => {
    for (let i = 0; i < 20; i++) {
      expect(registry.create('agent-1', {
        label: `t-${i}`,
        message: 'm',
        delaySeconds: 600,
      })).not.toBeNull();
    }
    const overflow = registry.create('agent-1', {
      label: 'overflow',
      message: 'm',
      delaySeconds: 600,
    });
    expect(overflow).toBeNull();
  });

  it('clearAgent marks all pending timers as cancelled in DB', () => {
    registry.create('agent-1', { label: 'a', message: 'm', delaySeconds: 600 });
    registry.create('agent-1', { label: 'b', message: 'm', delaySeconds: 300 });

    registry.clearAgent('agent-1');

    const all = registry.getAllTimers();
    expect(all).toHaveLength(2);
    expect(all.every(t => t.status === 'cancelled')).toBe(true);
  });
});

// ── Event payload tests ─────────────────────────────────────────────

describe('Timer event payloads', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry(createTestDb());
  });

  afterEach(() => {
    registry.stop();
    vi.useRealTimers();
  });

  it('timer:created event includes full timer data', () => {
    const events: Timer[] = [];
    registry.on('timer:created', (t: Timer) => events.push(t));

    registry.create('agent-1', {
      label: 'event-test',
      message: 'check payload',
      delaySeconds: 120,
      repeat: true,
    }, 'developer', 'lead-1');

    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.agentId).toBe('agent-1');
    expect(evt.agentRole).toBe('developer');
    expect(evt.leadId).toBe('lead-1');
    expect(evt.label).toBe('event-test');
    expect(evt.message).toBe('check payload');
    expect(evt.delaySeconds).toBe(120);
    expect(evt.status).toBe('pending');
    expect(evt.repeat).toBe(true);
    expect(evt.id).toMatch(/^tmr-/);
    expect(evt.fireAt).toBeGreaterThan(Date.now() - 1000);
    expect(evt.createdAt).toBeDefined();
  });

  it('timer:cancelled event includes the timer data', () => {
    const events: Timer[] = [];
    registry.on('timer:cancelled', (t: Timer) => events.push(t));

    const timer = registry.create('agent-1', {
      label: 'will-cancel',
      message: 'm',
      delaySeconds: 60,
    })!;
    registry.cancel(timer.id, 'agent-1');

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(timer.id);
    expect(events[0].label).toBe('will-cancel');
  });

  it('timer:fired event includes the timer data', () => {
    vi.useFakeTimers();
    const events: Timer[] = [];
    registry.on('timer:fired', (t: Timer) => events.push(t));

    registry.create('agent-1', {
      label: 'fire-event',
      message: 'fired!',
      delaySeconds: 10,
    });
    registry.start();
    vi.advanceTimersByTime(15_000);

    expect(events).toHaveLength(1);
    expect(events[0].label).toBe('fire-event');
    expect(events[0].message).toBe('fired!');
    expect(events[0].agentId).toBe('agent-1');
  });
});

// ── Multi-agent concurrency ─────────────────────────────────────────

describe('Multi-agent timer scenarios', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry(createTestDb());
  });

  afterEach(() => {
    registry.stop();
    vi.useRealTimers();
  });

  it('multiple agents create timers simultaneously', () => {
    const agents = ['agent-1', 'agent-2', 'agent-3'];
    for (const agentId of agents) {
      for (let i = 0; i < 5; i++) {
        const timer = registry.create(agentId, {
          label: `${agentId}-timer-${i}`,
          message: 'm',
          delaySeconds: 60 * (i + 1),
        });
        expect(timer).not.toBeNull();
      }
    }
    expect(registry.getPendingTimers()).toHaveLength(15);
    expect(registry.getAllTimers()).toHaveLength(15);
  });

  it('agent can only cancel their own timers', () => {
    const t1 = registry.create('agent-1', { label: 'mine', message: 'm', delaySeconds: 60 })!;
    const t2 = registry.create('agent-2', { label: 'yours', message: 'm', delaySeconds: 60 })!;

    expect(registry.cancel(t1.id, 'agent-2')).toBe(false); // wrong agent
    expect(registry.cancel(t2.id, 'agent-1')).toBe(false); // wrong agent
    expect(registry.cancel(t1.id, 'agent-1')).toBe(true);  // correct agent
    expect(registry.cancel(t2.id, 'agent-2')).toBe(true);  // correct agent
  });

  it('clearAgent only affects target agent timers', () => {
    registry.create('agent-1', { label: 'a1-timer', message: 'm', delaySeconds: 600 });
    registry.create('agent-2', { label: 'a2-timer', message: 'm', delaySeconds: 600 });
    registry.create('agent-3', { label: 'a3-timer', message: 'm', delaySeconds: 600 });

    registry.clearAgent('agent-2');

    expect(registry.getAgentTimers('agent-1')).toHaveLength(1);
    expect(registry.getAgentTimers('agent-2')).toHaveLength(0);
    expect(registry.getAgentTimers('agent-3')).toHaveLength(1);
  });

  it('timers from multiple agents fire independently', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    registry.on('timer:fired', (t: Timer) => fired.push(`${t.agentId}:${t.label}`));

    registry.create('agent-1', { label: 'fast', message: 'm', delaySeconds: 10 });
    registry.create('agent-2', { label: 'slow', message: 'm', delaySeconds: 20 });
    registry.start();

    vi.advanceTimersByTime(15_000);
    expect(fired).toEqual(['agent-1:fast']);

    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual(['agent-1:fast', 'agent-2:slow']);
  });
});

// ── Full lifecycle test ─────────────────────────────────────────────

describe('Timer full lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('create → list → fire → callback → cleanup', () => {
    vi.useFakeTimers();
    const db = createTestDb();
    const registry = new TimerRegistry(db);
    const firedEvents: Timer[] = [];
    registry.on('timer:fired', (t: Timer) => firedEvents.push(t));

    // 1. Create
    const timer = registry.create('agent-1', {
      label: 'lifecycle-test',
      message: 'Full lifecycle',
      delaySeconds: 30,
    }, 'developer', 'lead-1')!;
    expect(timer).not.toBeNull();
    expect(timer.status).toBe('pending');

    // 2. List — appears in pending
    expect(registry.getPendingTimers()).toHaveLength(1);
    expect(registry.getAgentTimers('agent-1')).toHaveLength(1);

    // 3. Start and fire
    registry.start();
    vi.advanceTimersByTime(35_000);

    // 4. Callback fires
    expect(firedEvents).toHaveLength(1);
    expect(firedEvents[0].label).toBe('lifecycle-test');
    expect(firedEvents[0].agentId).toBe('agent-1');

    // 5. No longer pending
    expect(registry.getPendingTimers()).toHaveLength(0);

    // 6. Still in DB as fired
    const all = registry.getAllTimers();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('fired');

    registry.stop();
  });

  it('create → list → cancel → verify gone', () => {
    const registry = new TimerRegistry(createTestDb());

    const timer = registry.create('agent-1', {
      label: 'cancel-lifecycle',
      message: 'Will cancel',
      delaySeconds: 600,
    })!;

    // Listed as pending
    expect(registry.getPendingTimers()).toHaveLength(1);

    // Cancel
    const cancelled = registry.cancel(timer.id, 'agent-1');
    expect(cancelled).toBe(true);

    // Gone from pending
    expect(registry.getPendingTimers()).toHaveLength(0);

    // Still in DB as cancelled
    const all = registry.getAllTimers();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('cancelled');

    registry.stop();
  });
});
