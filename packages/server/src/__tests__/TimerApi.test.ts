import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TimerRegistry } from '../coordination/TimerRegistry.js';
import { createTestTimerDb } from './helpers/createTestTimerDb.js';
import { setTimerSchema } from '../agents/commands/commandSchemas.js';

describe('Timer API data shape', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry(createTestTimerDb());
  });

  afterEach(() => {
    registry.stop();
  });

  it('getAllTimers returns timers with expected fields', () => {
    registry.create('agent-1', {
      label: 'check-build',
      message: 'Check if the build passed',
      delaySeconds: 300,
    });

    const timers = registry.getAllTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      agentId: 'agent-1',
      label: 'check-build',
      message: 'Check if the build passed',
      status: 'pending',
      repeat: false,
    });
    expect(timers[0].id).toBeDefined();
    expect(timers[0].fireAt).toBeGreaterThan(Date.now());
    expect(timers[0].createdAt).toBeDefined();
  });

  it('includes repeat timers with delaySeconds', () => {
    registry.create('agent-2', {
      label: 'poll-status',
      message: 'Check status',
      delaySeconds: 60,
      repeat: true,
    });

    const timers = registry.getAllTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0].repeat).toBe(true);
    expect(timers[0].delaySeconds).toBe(60);
  });

  it('timer API response shape includes remainingMs', () => {
    registry.create('agent-1', {
      label: 'test-timer',
      message: 'Hello',
      delaySeconds: 120,
    });

    const timers = registry.getAllTimers();
    const apiResponse = timers.map(t => ({
      ...t,
      remainingMs: t.status === 'pending' ? Math.max(0, t.fireAt - Date.now()) : 0,
    }));

    expect(apiResponse).toHaveLength(1);
    expect(apiResponse[0].remainingMs).toBeGreaterThan(0);
    expect(apiResponse[0].remainingMs).toBeLessThanOrEqual(120_000);
  });

  it('returns timers from multiple agents', () => {
    registry.create('agent-1', { label: 'timer-a', message: 'A', delaySeconds: 60 });
    registry.create('agent-2', { label: 'timer-b', message: 'B', delaySeconds: 120 });
    registry.create('agent-1', { label: 'timer-c', message: 'C', delaySeconds: 180 });

    const timers = registry.getAllTimers();
    expect(timers).toHaveLength(3);

    const agent1Timers = timers.filter(t => t.agentId === 'agent-1');
    const agent2Timers = timers.filter(t => t.agentId === 'agent-2');
    expect(agent1Timers).toHaveLength(2);
    expect(agent2Timers).toHaveLength(1);
  });

  it('cancelled timers show status=cancelled in getAllTimers', () => {
    const timer = registry.create('agent-1', { label: 'will-cancel', message: 'X', delaySeconds: 60 });
    expect(registry.getAllTimers()).toHaveLength(1);

    registry.cancel(timer!.id, 'agent-1');
    const all = registry.getAllTimers();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('cancelled');
  });

  it('getPendingTimers excludes cancelled', () => {
    const timer = registry.create('agent-1', { label: 'will-cancel', message: 'X', delaySeconds: 60 });
    registry.cancel(timer!.id, 'agent-1');
    expect(registry.getPendingTimers()).toHaveLength(0);
  });

  describe('cancel by timer ID (web UI path)', () => {
    it('cancels a pending timer using its own agentId', () => {
      const timer = registry.create('agent-1', { label: 'web-cancel', message: 'X', delaySeconds: 300 })!;
      // Simulates what DELETE /timers/:id does: look up timer, cancel with its own agentId
      const found = registry.getAllTimers().find(t => t.id === timer.id);
      expect(found).toBeDefined();
      expect(found!.status).toBe('pending');

      const ok = registry.cancel(found!.id, found!.agentId);
      expect(ok).toBe(true);
      expect(registry.getAllTimers().find(t => t.id === timer.id)!.status).toBe('cancelled');
    });

    it('cannot cancel an already cancelled timer', () => {
      const timer = registry.create('agent-1', { label: 'double-cancel', message: 'X', delaySeconds: 300 })!;
      registry.cancel(timer.id, 'agent-1');
      // Second cancel should fail (not in pending map)
      const ok = registry.cancel(timer.id, 'agent-1');
      expect(ok).toBe(false);
    });
  });
});

describe('Duration parsing in SET_TIMER schema', () => {
  const parse = (delay: string | number) =>
    setTimerSchema.safeParse({ label: 'test', delay, message: 'msg' });

  it('accepts raw seconds as number', () => {
    const result = parse(300);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(300);
  });

  it('accepts seconds as numeric string', () => {
    const result = parse('300');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(300);
  });

  it('parses "30m" as 1800 seconds', () => {
    const result = parse('30m');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(1800);
  });

  it('parses "2h" as 7200 seconds', () => {
    const result = parse('2h');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(7200);
  });

  it('parses "1d" as 86400 seconds', () => {
    const result = parse('1d');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(86400);
  });

  it('parses "5min" as 300 seconds', () => {
    const result = parse('5min');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(300);
  });

  it('parses "30s" as 30 seconds', () => {
    const result = parse('30s');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(30);
  });

  it('parses "1hour" as 3600 seconds', () => {
    const result = parse('1hour');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.delay).toBe(3600);
  });

  it('rejects invalid format like "abc"', () => {
    const result = parse('abc');
    expect(result.success).toBe(false);
  });

  it('rejects "2h" value below min (if numeric part maps below 5s)', () => {
    const result = parse('1s');
    expect(result.success).toBe(false); // 1 second < 5s minimum
  });

  it('rejects "2d" value above max (172800 > 86400)', () => {
    const result = parse('2d');
    expect(result.success).toBe(false); // 172800 > 86400 max
  });
});
