import { EventEmitter } from 'events';
import { eq, and, lt, or } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// ── Types ─────────────────────────────────────────────────────────

export interface Timer {
  id: string;
  agentId: string;
  agentRole: string;
  leadId: string | null;
  label: string;
  message: string;
  delaySeconds: number;
  fireAt: number; // epoch ms
  createdAt: string;
  status: 'pending' | 'fired' | 'cancelled';
  repeat: boolean;
}

export interface TimerInput {
  label: string;
  message: string;
  delaySeconds: number;
  repeat?: boolean;
}

// ── TimerRegistry ─────────────────────────────────────────────────

const MAX_TIMERS_PER_AGENT = 20;
const CHECK_INTERVAL_MS = 5_000;
/** Clean up fired/cancelled timers older than 7 days */
const CLEANUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * DB-backed timer registry. Persists timers to SQLite and schedules
 * them in-memory. On startup, loads pending timers from DB.
 */
export class TimerRegistry extends EventEmitter {
  private db: BetterSQLite3Database<typeof schema>;
  private interval: ReturnType<typeof setInterval> | null = null;
  /** In-memory cache of pending timers for fast tick() checks */
  private pending = new Map<string, Timer>();

  constructor(db: BetterSQLite3Database<typeof schema>) {
    super();
    this.db = db;
  }

  start(): void {
    if (this.interval) return;
    this.cancelOrphaned();
    this.cleanupOld();
    this.loadPending();
    this.interval = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    logger.info('timer', `TimerRegistry started — ${this.pending.size} pending timers loaded`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Load all pending timers from DB into memory */
  private loadPending(): void {
    const rows = this.db.select().from(schema.timers)
      .where(eq(schema.timers.status, 'pending'))
      .all();
    this.pending.clear();
    for (const row of rows) {
      this.pending.set(row.id, this.rowToTimer(row));
    }
  }

  /** Cancel all pending timers on startup — no agents are running yet, so any
   *  surviving pending timers are orphaned from previous server runs. Agents
   *  re-create timers when they need them. */
  private cancelOrphaned(): void {
    const result = this.db.update(schema.timers)
      .set({ status: 'cancelled' })
      .where(eq(schema.timers.status, 'pending'))
      .run();
    if (result.changes > 0) {
      logger.info('timer', `Cancelled ${result.changes} orphaned pending timer(s) from previous run`);
    }
  }

  /** Remove fired/cancelled timers older than CLEANUP_TTL_MS */
  private cleanupOld(): void {
    const cutoff = new Date(Date.now() - CLEANUP_TTL_MS).toISOString();
    const result = this.db.delete(schema.timers)
      .where(
        and(
          or(eq(schema.timers.status, 'fired'), eq(schema.timers.status, 'cancelled')),
          lt(schema.timers.createdAt, cutoff),
        ),
      )
      .run();
    if (result.changes > 0) {
      logger.info('timer', `Cleaned up ${result.changes} old fired/cancelled timers`);
    }
  }

  /** Create a timer. Returns the timer or null if limit reached. */
  create(agentId: string, input: TimerInput, agentRole = 'unknown', leadId: string | null = null): Timer | null {
    if (!Number.isFinite(input.delaySeconds) || input.delaySeconds < 0 || input.delaySeconds > 86400) {
      return null;
    }

    const agentTimers = this.getAgentTimers(agentId);
    if (agentTimers.length >= MAX_TIMERS_PER_AGENT) {
      return null;
    }

    const now = Date.now();
    const timer: Timer = {
      id: `tmr-${now}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      agentRole,
      leadId,
      label: input.label,
      message: input.message,
      delaySeconds: input.delaySeconds,
      fireAt: now + input.delaySeconds * 1000,
      createdAt: new Date().toISOString(),
      status: 'pending',
      repeat: input.repeat ?? false,
    };

    // Persist to DB
    this.db.insert(schema.timers).values({
      id: timer.id,
      agentId: timer.agentId,
      agentRole: timer.agentRole,
      leadId: timer.leadId,
      label: timer.label,
      message: timer.message,
      delaySeconds: timer.delaySeconds,
      fireAt: new Date(timer.fireAt).toISOString(),
      status: 'pending',
      repeat: timer.repeat ? 1 : 0,
    }).run();

    this.pending.set(timer.id, timer);
    this.emit('timer:created', timer);
    logger.info('timer', `Timer "${timer.label}" set for ${agentId.slice(0, 8)} — fires in ${input.delaySeconds}s`);
    return timer;
  }

  /** Cancel a timer by ID. Returns true if found and cancelled. */
  cancel(timerId: string, agentId: string): boolean {
    const timer = this.pending.get(timerId);
    if (!timer || timer.agentId !== agentId) return false;

    this.pending.delete(timerId);
    this.db.update(schema.timers)
      .set({ status: 'cancelled' })
      .where(eq(schema.timers.id, timerId))
      .run();

    this.emit('timer:cancelled', timer);
    logger.info('timer', `Timer "${timer.label}" cancelled for ${agentId.slice(0, 8)}`);
    return true;
  }

  /** Get all pending timers for an agent */
  getAgentTimers(agentId: string): Timer[] {
    return Array.from(this.pending.values()).filter(t => t.agentId === agentId);
  }

  /** Get all timers (pending + fired + cancelled) from DB */
  getAllTimers(): Timer[] {
    const rows = this.db.select().from(schema.timers).all();
    return rows.map(r => this.rowToTimer(r));
  }

  /** Get only pending timers */
  getPendingTimers(): Timer[] {
    return Array.from(this.pending.values());
  }

  /** Check for timers that should fire */
  private tick(): void {
    const now = Date.now();
    for (const timer of this.pending.values()) {
      if (timer.fireAt <= now) {
        if (timer.repeat) {
          // Reschedule: update fireAt in DB and memory BEFORE emitting
          const newFireAt = now + timer.delaySeconds * 1000;
          this.db.update(schema.timers)
            .set({ fireAt: new Date(newFireAt).toISOString(), status: 'pending' })
            .where(eq(schema.timers.id, timer.id))
            .run();
          timer.status = 'fired';
          this.emit('timer:fired', timer);
          logger.info('timer', `Timer "${timer.label}" fired for ${timer.agentId.slice(0, 8)}`);
          timer.status = 'pending';
          timer.fireAt = newFireAt;
        } else {
          // Persist fired status BEFORE emitting to prevent double-fire on crash
          this.pending.delete(timer.id);
          this.db.update(schema.timers)
            .set({ status: 'fired' })
            .where(eq(schema.timers.id, timer.id))
            .run();
          timer.status = 'fired';
          this.emit('timer:fired', timer);
          logger.info('timer', `Timer "${timer.label}" fired for ${timer.agentId.slice(0, 8)}`);
        }
      }
    }
  }

  /** Remove all timers for an agent (cleanup on termination) */
  clearAgent(agentId: string): number {
    const agentTimers = this.getAgentTimers(agentId);
    for (const timer of agentTimers) {
      this.pending.delete(timer.id);
    }
    // Mark as cancelled in DB
    this.db.update(schema.timers)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.timers.agentId, agentId), eq(schema.timers.status, 'pending')))
      .run();
    return agentTimers.length;
  }

  private rowToTimer(row: typeof schema.timers.$inferSelect): Timer {
    return {
      id: row.id,
      agentId: row.agentId,
      agentRole: row.agentRole,
      leadId: row.leadId,
      label: row.label,
      message: row.message,
      delaySeconds: row.delaySeconds,
      fireAt: new Date(row.fireAt).getTime(),
      createdAt: row.createdAt ?? new Date().toISOString(),
      status: row.status as Timer['status'],
      repeat: row.repeat === 1,
    };
  }
}
