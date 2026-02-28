import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetryManager } from '../agents/RetryManager.js';
import type { RetryRecord } from '../agents/RetryManager.js';

describe('RetryManager', () => {
  let manager: RetryManager;

  beforeEach(() => {
    vi.useFakeTimers();
    // Small baseDelayMs for test legibility
    manager = new RetryManager(3, 1000);
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  // ── 1. Schedules retry with exponential backoff ──────────────────────

  it('schedules retry with exponential backoff', () => {
    const t0 = Date.now();

    const r1 = manager.recordFailure('task-1', 'agent-1', 'developer', 'timeout');
    expect(r1.attempts).toBe(1);
    expect(r1.nextRetryAt).toBe(t0 + 1000); // 1000 * 2^0 = 1000ms
    expect(r1.status).toBe('pending');

    const r2 = manager.recordFailure('task-1', 'agent-1', 'developer', 'timeout');
    expect(r2.attempts).toBe(2);
    expect(r2.nextRetryAt).toBe(t0 + 2000); // 1000 * 2^1 = 2000ms

    const r3 = manager.recordFailure('task-1', 'agent-1', 'developer', 'timeout');
    expect(r3.attempts).toBe(3);
    expect(r3.nextRetryAt).toBe(t0 + 4000); // 1000 * 2^2 = 4000ms
  });

  // ── 2. Emits retry:scheduled event ──────────────────────────────────

  it('emits retry:scheduled event', () => {
    const handler = vi.fn();
    manager.on('retry:scheduled', handler);

    manager.recordFailure('task-2', 'agent-2', 'reviewer', 'error');

    expect(handler).toHaveBeenCalledOnce();
    const record = handler.mock.calls[0][0] as RetryRecord;
    expect(record.taskId).toBe('task-2');
    expect(record.agentId).toBe('agent-2');
    expect(record.agentRole).toBe('reviewer');
    expect(record.status).toBe('pending');
  });

  // ── 3. Emits retry:exhausted after max attempts ──────────────────────

  it('emits retry:exhausted after max attempts', () => {
    const exhaustedHandler = vi.fn();
    const scheduledHandler = vi.fn();
    manager.on('retry:exhausted', exhaustedHandler);
    manager.on('retry:scheduled', scheduledHandler);

    // Use up all 3 allowed attempts
    manager.recordFailure('task-3', 'agent-3', 'developer', 'err');
    manager.recordFailure('task-3', 'agent-3', 'developer', 'err');
    manager.recordFailure('task-3', 'agent-3', 'developer', 'err');

    expect(scheduledHandler).toHaveBeenCalledTimes(3);
    expect(exhaustedHandler).not.toHaveBeenCalled();

    // 4th failure → exhausted
    const record = manager.recordFailure('task-3', 'agent-3', 'developer', 'err');
    expect(record.status).toBe('exhausted');
    expect(record.nextRetryAt).toBe(0);
    expect(exhaustedHandler).toHaveBeenCalledOnce();
  });

  // ── 4. Emits retry:ready when retry is due ───────────────────────────

  it('emits retry:ready when retry is due', () => {
    const readyHandler = vi.fn();
    manager.on('retry:ready', readyHandler);

    manager.recordFailure('task-4', 'agent-4', 'tester', 'crash');

    manager.start(500);

    // Advance past the retry window (1000ms delay) + one interval tick
    vi.advanceTimersByTime(1500);

    expect(readyHandler).toHaveBeenCalledOnce();
    const record = readyHandler.mock.calls[0][0] as RetryRecord;
    expect(record.taskId).toBe('task-4');
    expect(record.status).toBe('retrying');
  });

  // ── 5. recordSuccess marks record as succeeded ───────────────────────

  it('recordSuccess marks record as succeeded', () => {
    const successHandler = vi.fn();
    manager.on('retry:succeeded', successHandler);

    manager.recordFailure('task-5', 'agent-5', 'developer', 'err');
    manager.recordSuccess('task-5');

    const record = manager.getRetry('task-5');
    expect(record?.status).toBe('succeeded');
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('recordSuccess is a no-op for unknown taskId', () => {
    const successHandler = vi.fn();
    manager.on('retry:succeeded', successHandler);
    manager.recordSuccess('nonexistent');
    expect(successHandler).not.toHaveBeenCalled();
  });

  // ── 6. getPendingCount returns correct count ─────────────────────────

  it('getPendingCount returns correct count', () => {
    expect(manager.getPendingCount()).toBe(0);

    manager.recordFailure('task-6a', 'agent-1', 'dev', 'err');
    manager.recordFailure('task-6b', 'agent-1', 'dev', 'err');
    expect(manager.getPendingCount()).toBe(2);

    manager.recordSuccess('task-6a');
    expect(manager.getPendingCount()).toBe(1);

    // Exhaust task-6b past max retries
    manager.recordFailure('task-6b', 'agent-1', 'dev', 'err');
    manager.recordFailure('task-6b', 'agent-1', 'dev', 'err');
    manager.recordFailure('task-6b', 'agent-1', 'dev', 'err'); // 4th → exhausted
    expect(manager.getPendingCount()).toBe(0);
  });

  // ── 7. Exponential backoff doubles delay each attempt ────────────────

  it('exponential backoff doubles delay each attempt', () => {
    const t0 = Date.now();
    const r1 = manager.recordFailure('task-7', 'agent-7', 'dev', 'err');
    const delay1 = r1.nextRetryAt - t0;

    const r2 = manager.recordFailure('task-7', 'agent-7', 'dev', 'err');
    const delay2 = r2.nextRetryAt - t0;

    const r3 = manager.recordFailure('task-7', 'agent-7', 'dev', 'err');
    const delay3 = r3.nextRetryAt - t0;

    expect(delay2).toBe(delay1 * 2);
    expect(delay3).toBe(delay1 * 4);
  });

  // ── 8. dispose clears all state ──────────────────────────────────────

  it('dispose clears all state', () => {
    manager.recordFailure('task-8', 'agent-8', 'dev', 'err');
    manager.start(500);

    manager.dispose();

    expect(manager.getRetries()).toHaveLength(0);
    expect(manager.getPendingCount()).toBe(0);

    // Timer should be cleared — no retry:ready events after dispose
    const readyHandler = vi.fn();
    manager.on('retry:ready', readyHandler);
    vi.advanceTimersByTime(5000);
    expect(readyHandler).not.toHaveBeenCalled();
  });

  // ── 9. getRetries returns all records ────────────────────────────────

  it('getRetries returns all records', () => {
    manager.recordFailure('task-a', 'agent-1', 'dev', 'err');
    manager.recordFailure('task-b', 'agent-2', 'qa', 'err');

    const retries = manager.getRetries();
    expect(retries).toHaveLength(2);
    expect(retries.map(r => r.taskId)).toContain('task-a');
    expect(retries.map(r => r.taskId)).toContain('task-b');
  });

  // ── 10. start is idempotent ──────────────────────────────────────────

  it('start is idempotent — calling twice does not double-fire', () => {
    const readyHandler = vi.fn();
    manager.on('retry:ready', readyHandler);

    manager.recordFailure('task-10', 'agent-10', 'dev', 'err');

    manager.start(500);
    manager.start(500); // second call should be ignored

    vi.advanceTimersByTime(1500);
    expect(readyHandler).toHaveBeenCalledOnce();
  });
});
