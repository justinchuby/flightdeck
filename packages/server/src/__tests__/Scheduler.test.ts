import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, ScheduledTask } from '../utils/Scheduler.js';

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: overrides.id ?? 'task-1',
    interval: overrides.interval ?? 1000,
    run: overrides.run ?? vi.fn(),
  };
}

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('register adds task and starts interval', () => {
    const task = makeTask({ id: 'ping' });
    scheduler.register(task);
    expect(scheduler.getRegistered()).toContain('ping');
  });

  it('registered task runs at interval', () => {
    const run = vi.fn();
    scheduler.register(makeTask({ id: 'tick', interval: 500, run }));

    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('register replaces duplicate ID', () => {
    const firstRun = vi.fn();
    const secondRun = vi.fn();

    scheduler.register(makeTask({ id: 'dup', interval: 1000, run: firstRun }));
    scheduler.register(makeTask({ id: 'dup', interval: 1000, run: secondRun }));

    expect(scheduler.getRegistered().filter((id) => id === 'dup')).toHaveLength(1);

    // Advance time — only the second run function should fire
    vi.advanceTimersByTime(1000);
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('unregister removes task and returns true', () => {
    scheduler.register(makeTask({ id: 'removable' }));
    const result = scheduler.unregister('removable');

    expect(result).toBe(true);
    expect(scheduler.getRegistered()).toEqual([]);
  });

  it('unregister returns false for unknown ID', () => {
    expect(scheduler.unregister('no-such-task')).toBe(false);
  });

  it('stop clears all tasks', () => {
    scheduler.register(makeTask({ id: 'a', interval: 100 }));
    scheduler.register(makeTask({ id: 'b', interval: 200 }));
    scheduler.register(makeTask({ id: 'c', interval: 300 }));

    scheduler.stop();

    expect(scheduler.getRegistered()).toEqual([]);
  });

  it('task error is caught and task stays registered', async () => {
    const { logger } = await import('../utils/logger.js');
    const run = vi.fn().mockRejectedValue(new Error('boom'));

    scheduler.register(makeTask({ id: 'failing', interval: 1000, run }));

    // Advance timer to trigger the task, then flush the microtask queue
    // so the async catch handler runs.
    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.getRegistered()).toContain('failing');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'timer',
        msg: 'Task failed',
        taskId: 'failing',
        err: 'boom',
      }),
    );
  });

  it('async task runs correctly', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    scheduler.register(makeTask({ id: 'async-job', interval: 2000, run }));

    vi.advanceTimersByTime(2000);
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('getRegistered returns all IDs', () => {
    scheduler.register(makeTask({ id: 'x' }));
    scheduler.register(makeTask({ id: 'y' }));
    scheduler.register(makeTask({ id: 'z' }));

    const ids = scheduler.getRegistered();
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['x', 'y', 'z']));
  });
});
