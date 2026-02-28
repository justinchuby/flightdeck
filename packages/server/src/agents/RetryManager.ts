import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export interface RetryRecord {
  taskId: string;
  agentId: string;
  agentRole: string;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: number;
  nextRetryAt: number;
  error: string;
  status: 'pending' | 'retrying' | 'exhausted' | 'succeeded';
}

export class RetryManager extends EventEmitter {
  private retries: Map<string, RetryRecord> = new Map(); // taskId → record
  private maxAttempts: number;
  private baseDelayMs: number;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxAttempts: number = 3, baseDelayMs: number = 30_000) {
    super();
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
  }

  start(intervalMs: number = 10_000): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.checkRetries(), intervalMs);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /** Record a failure and schedule retry */
  recordFailure(taskId: string, agentId: string, agentRole: string, error: string): RetryRecord {
    const existing = this.retries.get(taskId);
    const attempts = (existing?.attempts ?? 0) + 1;

    if (attempts > this.maxAttempts) {
      const record: RetryRecord = {
        taskId, agentId, agentRole, attempts, maxAttempts: this.maxAttempts,
        lastAttemptAt: Date.now(), nextRetryAt: 0, error, status: 'exhausted',
      };
      this.retries.set(taskId, record);
      this.emit('retry:exhausted', record);
      logger.warn('retry', `Task ${taskId.slice(0, 8)} exhausted all ${this.maxAttempts} retries`);
      return record;
    }

    // Exponential backoff: 30s, 60s, 120s, …
    const delay = this.baseDelayMs * Math.pow(2, attempts - 1);
    const record: RetryRecord = {
      taskId, agentId, agentRole, attempts, maxAttempts: this.maxAttempts,
      lastAttemptAt: Date.now(), nextRetryAt: Date.now() + delay, error, status: 'pending',
    };
    this.retries.set(taskId, record);
    this.emit('retry:scheduled', record);
    logger.info('retry', `Scheduled retry ${attempts}/${this.maxAttempts} for task ${taskId.slice(0, 8)} in ${delay / 1000}s`);
    return record;
  }

  /** Mark a retry as successful */
  recordSuccess(taskId: string): void {
    const record = this.retries.get(taskId);
    if (record) {
      record.status = 'succeeded';
      this.emit('retry:succeeded', record);
    }
  }

  /** Check for retries that are due */
  private checkRetries(): void {
    const now = Date.now();
    for (const [taskId, record] of this.retries) {
      if (record.status === 'pending' && now >= record.nextRetryAt) {
        record.status = 'retrying';
        this.emit('retry:ready', record);
        logger.info('retry', `Retry ${record.attempts}/${record.maxAttempts} ready for task ${taskId.slice(0, 8)}`);
      }
    }
  }

  getRetries(): RetryRecord[] { return [...this.retries.values()]; }
  getRetry(taskId: string): RetryRecord | undefined { return this.retries.get(taskId); }
  getPendingCount(): number {
    return [...this.retries.values()].filter(r => r.status === 'pending' || r.status === 'retrying').length;
  }

  dispose(): void {
    this.stop();
    this.retries.clear();
  }
}
