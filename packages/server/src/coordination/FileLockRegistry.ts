import { EventEmitter } from 'events';
import { eq, and, sql } from 'drizzle-orm';
import { Database } from '../db/database.js';
import { fileLocks, utcNow } from '../db/schema.js';

export interface FileLock {
  filePath: string;
  agentId: string;
  agentRole: string;
  projectId: string;
  reason: string;
  acquiredAt: string;
  expiresAt: string;
}

function rowToFileLock(row: typeof fileLocks.$inferSelect): FileLock {
  return {
    filePath: row.filePath,
    agentId: row.agentId,
    agentRole: row.agentRole,
    projectId: row.projectId ?? '',
    reason: row.reason ?? '',
    acquiredAt: row.acquiredAt!,
    expiresAt: row.expiresAt,
  };
}

/** Check if two paths conflict via simple glob/prefix matching. */
function pathsConflict(existingPattern: string, requested: string): boolean {
  if (existingPattern === requested) return true;

  // Handle glob patterns ending with /*
  if (existingPattern.endsWith('/*')) {
    const prefix = existingPattern.slice(0, -1); // remove trailing *
    if (requested.startsWith(prefix)) return true;
  }
  if (requested.endsWith('/*')) {
    const prefix = requested.slice(0, -1);
    if (existingPattern.startsWith(prefix)) return true;
  }

  return false;
}

const activeFilter = sql`${fileLocks.expiresAt} > ${utcNow}`;
const expiredFilter = sql`${fileLocks.expiresAt} <= ${utcNow}`;

export class FileLockRegistry extends EventEmitter {
  private db: Database;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  /** Start a periodic timer that actively cleans expired locks and emits events. */
  startExpiryCheck(intervalMs = 30_000): void {
    if (this.expiryTimer) return;
    this.expiryTimer = setInterval(() => this._cleanExpired(), intervalMs);
  }

  /** Stop the periodic expiry check timer. */
  stopExpiryCheck(): void {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  /** Validate file path to prevent traversal attacks */
  private validatePath(filePath: string): void {
    // Reject path traversal attempts
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/../') || normalized.startsWith('../') || normalized.endsWith('/..')) {
      throw new Error(`Invalid file path: path traversal detected`);
    }
    // Reject null bytes
    if (filePath.includes('\0')) {
      throw new Error(`Invalid file path: null bytes not allowed`);
    }
  }

  // Lock conflict detection is intentionally global (not per-project).
  // Two projects working in the same repo MUST see each other's locks to
  // prevent concurrent edits to the same file. Do NOT scope acquire() by
  // projectId — the projectId column is for UI filtering only.
  acquire(
    agentId: string,
    agentRole: string,
    filePath: string,
    reason = '',
    ttlSeconds = 300,
    projectId = '',
  ): { ok: boolean; holder?: string } {
    this.validatePath(filePath);
    this._cleanExpired();

    const activeLocks = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(activeFilter)
      .all();

    for (const lock of activeLocks) {
      if (lock.agentId === agentId && lock.filePath === filePath) {
        // Same agent re-acquiring same exact path — allow (refresh)
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        this.db.drizzle
          .update(fileLocks)
          .set({ expiresAt, reason, projectId })
          .where(eq(fileLocks.filePath, filePath))
          .run();
        return { ok: true };
      }
      if (lock.agentId !== agentId && pathsConflict(lock.filePath, filePath)) {
        return { ok: false, holder: lock.agentId };
      }
    }

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.db.drizzle
      .insert(fileLocks)
      .values({ filePath, agentId, agentRole, reason, expiresAt, projectId })
      .onConflictDoUpdate({
        target: fileLocks.filePath,
        set: { agentId, agentRole, reason, expiresAt, projectId },
      })
      .run();

    this.emit('lock:acquired', { filePath, agentId, agentRole, reason, projectId });
    return { ok: true };
  }

  release(agentId: string, filePath: string): boolean {
    const result = this.db.drizzle
      .delete(fileLocks)
      .where(and(eq(fileLocks.filePath, filePath), eq(fileLocks.agentId, agentId)))
      .run();
    if (result.changes > 0) {
      this.emit('lock:released', { filePath, agentId });
      return true;
    }
    return false;
  }

  releaseAll(agentId: string): number {
    const result = this.db.drizzle
      .delete(fileLocks)
      .where(eq(fileLocks.agentId, agentId))
      .run();
    return result.changes;
  }

  isLocked(filePath: string): { locked: boolean; holder?: string; role?: string; reason?: string } {
    this._cleanExpired();
    const row = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(and(eq(fileLocks.filePath, filePath), activeFilter))
      .get();
    if (row) {
      return { locked: true, holder: row.agentId, role: row.agentRole, reason: row.reason ?? '' };
    }

    // Check glob conflicts
    const activeLocks = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(activeFilter)
      .all();
    for (const lock of activeLocks) {
      if (pathsConflict(lock.filePath, filePath)) {
        return { locked: true, holder: lock.agentId, role: lock.agentRole, reason: lock.reason ?? '' };
      }
    }

    return { locked: false };
  }

  getAll(): FileLock[] {
    this._cleanExpired();
    const rows = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(activeFilter)
      .all();
    return rows.map(rowToFileLock);
  }

  getByAgent(agentId: string): FileLock[] {
    this._cleanExpired();
    const rows = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(and(eq(fileLocks.agentId, agentId), activeFilter))
      .all();
    return rows.map(rowToFileLock);
  }

  /** Return only active locks belonging to a specific project */
  getByProject(projectId: string): FileLock[] {
    this._cleanExpired();
    const rows = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(and(eq(fileLocks.projectId, projectId), activeFilter))
      .all();
    return rows.map(rowToFileLock);
  }

  cleanExpired(): FileLock[] {
    return this._cleanExpired();
  }

  private _cleanExpired(): FileLock[] {
    // Find expired locks before deleting so we can notify agents
    const expired = this.db.drizzle
      .select()
      .from(fileLocks)
      .where(expiredFilter)
      .all();
    if (expired.length === 0) return [];

    this.db.drizzle
      .delete(fileLocks)
      .where(expiredFilter)
      .run();

    const result = expired.map(rowToFileLock);
    for (const lock of result) {
      this.emit('lock:expired', { filePath: lock.filePath, agentId: lock.agentId, agentRole: lock.agentRole });
    }
    return result;
  }
}
