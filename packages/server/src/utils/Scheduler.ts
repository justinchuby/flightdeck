import { logger } from './logger.js';

export interface ScheduledTask {
  id: string;
  interval: number; // milliseconds
  run: () => void | Promise<void>;
}

export class Scheduler {
  private tasks = new Map<string, { task: ScheduledTask; timer: ReturnType<typeof setInterval> }>();

  register(task: ScheduledTask): void {
    if (this.tasks.has(task.id)) {
      this.unregister(task.id);
    }
    const timer = setInterval(async () => {
      try {
        await task.run();
      } catch (err) {
        logger.debug({ module: 'timer', msg: 'Task failed', taskId: task.id, err: (err as Error).message });
      }
    }, task.interval);
    this.tasks.set(task.id, { task, timer });
    logger.info({ module: 'timer', msg: 'Task registered', taskId: task.id, intervalMs: task.interval });
  }

  unregister(id: string): boolean {
    const entry = this.tasks.get(id);
    if (!entry) return false;
    clearInterval(entry.timer);
    this.tasks.delete(id);
    return true;
  }

  stop(): void {
    for (const [id, entry] of this.tasks) {
      clearInterval(entry.timer);
      logger.info({ module: 'timer', msg: 'Task stopped', taskId: id });
    }
    this.tasks.clear();
  }

  getRegistered(): string[] {
    return Array.from(this.tasks.keys());
  }
}
