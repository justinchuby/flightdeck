import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../db/database.js';
import { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';

describe('FileLockRegistry', () => {
  let db: Database;
  let registry: FileLockRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    registry = new FileLockRegistry(db);
  });

  afterEach(() => {
    registry.stopExpiryCheck();
    db.close();
  });

  it('can acquire a lock on an unlocked file', () => {
    const result = registry.acquire('agent-1', 'developer', 'src/index.ts', 'editing');
    expect(result.ok).toBe(true);
    expect(result.holder).toBeUndefined();
  });

  it('returns holder info when trying to lock an already-locked file', () => {
    registry.acquire('agent-1', 'developer', 'src/index.ts', 'editing');
    const result = registry.acquire('agent-2', 'reviewer', 'src/index.ts', 'reviewing');
    expect(result.ok).toBe(false);
    expect(result.holder).toBe('agent-1');
  });

  it('agent can release their own lock', () => {
    registry.acquire('agent-1', 'developer', 'src/index.ts');
    const released = registry.release('agent-1', 'src/index.ts');
    expect(released).toBe(true);

    const status = registry.isLocked('src/index.ts');
    expect(status.locked).toBe(false);
  });

  it('cannot release another agent\'s lock', () => {
    registry.acquire('agent-1', 'developer', 'src/index.ts');
    const released = registry.release('agent-2', 'src/index.ts');
    expect(released).toBe(false);

    const status = registry.isLocked('src/index.ts');
    expect(status.locked).toBe(true);
  });

  it('releaseAll releases all locks for an agent', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts');
    registry.acquire('agent-1', 'developer', 'src/b.ts');
    registry.acquire('agent-2', 'reviewer', 'src/c.ts');

    const count = registry.releaseAll('agent-1');
    expect(count).toBe(2);

    expect(registry.isLocked('src/a.ts').locked).toBe(false);
    expect(registry.isLocked('src/b.ts').locked).toBe(false);
    expect(registry.isLocked('src/c.ts').locked).toBe(true);
  });

  it('isLocked returns correct status', () => {
    expect(registry.isLocked('src/index.ts').locked).toBe(false);

    registry.acquire('agent-1', 'developer', 'src/index.ts', 'editing');
    const status = registry.isLocked('src/index.ts');
    expect(status.locked).toBe(true);
    expect(status.holder).toBe('agent-1');
    expect(status.role).toBe('developer');
    expect(status.reason).toBe('editing');
  });

  it('expired locks are auto-cleaned on acquire', () => {
    // Insert a lock with SQLite datetime format (matches datetime('now') for comparison)
    const pastTime = '2000-01-01 00:00:00';
    db.run(
      `INSERT INTO file_locks (file_path, agent_id, agent_role, reason, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ['src/old.ts', 'agent-1', 'developer', 'editing', pastTime],
    );

    // A new acquire should clean the expired lock
    registry.acquire('agent-2', 'reviewer', 'src/new.ts');

    const all = registry.getAll();
    const paths = all.map((l) => l.filePath);
    expect(paths).not.toContain('src/old.ts');
    expect(paths).toContain('src/new.ts');
  });

  it('glob pattern conflict: locking src/auth/* blocks src/auth/login.ts', () => {
    registry.acquire('agent-1', 'developer', 'src/auth/*', 'refactoring auth');
    const result = registry.acquire('agent-2', 'reviewer', 'src/auth/login.ts');
    expect(result.ok).toBe(false);
    expect(result.holder).toBe('agent-1');

    const status = registry.isLocked('src/auth/login.ts');
    expect(status.locked).toBe(true);
    expect(status.holder).toBe('agent-1');
  });

  it('getAll returns only active locks', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts');
    registry.acquire('agent-2', 'reviewer', 'src/b.ts');
    // Insert an already-expired lock with SQLite datetime format
    const pastTime = '2000-01-01 00:00:00';
    db.run(
      `INSERT INTO file_locks (file_path, agent_id, agent_role, reason, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ['src/expired.ts', 'agent-3', 'pm', '', pastTime],
    );

    const all = registry.getAll();
    expect(all.length).toBe(2);
    const paths = all.map((l) => l.filePath);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
  });

  it('getByAgent returns correct locks', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts');
    registry.acquire('agent-1', 'developer', 'src/b.ts');
    registry.acquire('agent-2', 'reviewer', 'src/c.ts');

    const locks = registry.getByAgent('agent-1');
    expect(locks.length).toBe(2);
    expect(locks.every((l) => l.agentId === 'agent-1')).toBe(true);
  });

  describe('TTL expiry timer', () => {
    it('emits lock:expired events when timer fires', () => {
      vi.useFakeTimers();
      const expiredEvents: any[] = [];
      registry.on('lock:expired', (data) => expiredEvents.push(data));

      // Insert an already-expired lock
      const pastTime = '2000-01-01 00:00:00';
      db.run(
        `INSERT INTO file_locks (file_path, agent_id, agent_role, reason, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ['src/stale.ts', 'agent-1', 'developer', 'editing', pastTime],
      );

      registry.startExpiryCheck(100);
      vi.advanceTimersByTime(100);

      expect(expiredEvents.length).toBe(1);
      expect(expiredEvents[0].filePath).toBe('src/stale.ts');
      expect(expiredEvents[0].agentId).toBe('agent-1');

      vi.useRealTimers();
    });

    it('stopExpiryCheck stops the timer', () => {
      vi.useFakeTimers();
      const expiredEvents: any[] = [];
      registry.on('lock:expired', (data) => expiredEvents.push(data));

      registry.startExpiryCheck(100);
      registry.stopExpiryCheck();

      // Insert expired lock after stop
      const pastTime = '2000-01-01 00:00:00';
      db.run(
        `INSERT INTO file_locks (file_path, agent_id, agent_role, reason, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ['src/stale.ts', 'agent-1', 'developer', 'editing', pastTime],
      );

      vi.advanceTimersByTime(200);
      expect(expiredEvents.length).toBe(0);

      vi.useRealTimers();
    });

    it('startExpiryCheck is idempotent', () => {
      vi.useFakeTimers();
      const expiredEvents: any[] = [];
      registry.on('lock:expired', (data) => expiredEvents.push(data));

      // Insert expired lock
      const pastTime = '2000-01-01 00:00:00';
      db.run(
        `INSERT INTO file_locks (file_path, agent_id, agent_role, reason, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ['src/stale.ts', 'agent-1', 'developer', 'editing', pastTime],
      );

      // Call start twice — should not create duplicate timers
      registry.startExpiryCheck(100);
      registry.startExpiryCheck(100);
      vi.advanceTimersByTime(100);

      expect(expiredEvents.length).toBe(1);

      vi.useRealTimers();
    });

    it('expired lock is removed and file becomes available', () => {
      vi.useFakeTimers();
      registry.startExpiryCheck(100);

      // Insert expired lock
      const pastTime = '2000-01-01 00:00:00';
      db.run(
        `INSERT INTO file_locks (file_path, agent_id, agent_role, reason, expires_at) VALUES (?, ?, ?, ?, ?)`,
        ['src/freed.ts', 'agent-1', 'developer', 'editing', pastTime],
      );

      vi.advanceTimersByTime(100);

      // Lock should now be available for another agent
      const result = registry.acquire('agent-2', 'reviewer', 'src/freed.ts');
      expect(result.ok).toBe(true);

      vi.useRealTimers();
    });
  });
});
