import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../db/database.js';
import { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import { ActivityLedger } from '../coordination/activity/ActivityLedger.js';
import { CollectiveMemory } from '../coordination/knowledge/CollectiveMemory.js';

// ── FileLockRegistry Project Scoping ─────────────────────────────────

describe('FileLockRegistry project scoping', () => {
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

  it('acquire stores projectId on the lock', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'editing', 300, 'proj-a');
    const locks = registry.getAll();
    expect(locks).toHaveLength(1);
    expect(locks[0].projectId).toBe('proj-a');
  });

  it('getByProject returns only locks for the specified project', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'editing', 300, 'proj-a');
    registry.acquire('agent-2', 'reviewer', 'src/b.ts', 'reviewing', 300, 'proj-b');
    registry.acquire('agent-3', 'developer', 'src/c.ts', 'editing', 300, 'proj-a');

    const projA = registry.getByProject('proj-a');
    expect(projA).toHaveLength(2);
    expect(projA.map(l => l.filePath).sort()).toEqual(['src/a.ts', 'src/c.ts']);

    const projB = registry.getByProject('proj-b');
    expect(projB).toHaveLength(1);
    expect(projB[0].filePath).toBe('src/b.ts');
  });

  it('getByProject returns empty for unknown project', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'editing', 300, 'proj-a');
    expect(registry.getByProject('proj-unknown')).toEqual([]);
  });

  it('conflict detection remains global across projects', () => {
    // Project A locks a file
    registry.acquire('agent-1', 'developer', 'src/shared.ts', 'editing', 300, 'proj-a');
    // Project B tries to lock the same file — should be blocked
    const result = registry.acquire('agent-2', 'reviewer', 'src/shared.ts', 'reviewing', 300, 'proj-b');
    expect(result.ok).toBe(false);
    expect(result.holder).toBe('agent-1');
  });

  it('glob conflict detection remains global across projects', () => {
    registry.acquire('agent-1', 'developer', 'src/auth/*', 'refactoring', 300, 'proj-a');
    const result = registry.acquire('agent-2', 'reviewer', 'src/auth/login.ts', 'editing', 300, 'proj-b');
    expect(result.ok).toBe(false);
    expect(result.holder).toBe('agent-1');
  });

  it('getAll returns locks from all projects', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'editing', 300, 'proj-a');
    registry.acquire('agent-2', 'reviewer', 'src/b.ts', 'reviewing', 300, 'proj-b');
    const all = registry.getAll();
    expect(all).toHaveLength(2);
  });

  it('projectId defaults to empty string when not specified', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'editing');
    const locks = registry.getAll();
    expect(locks[0].projectId).toBe('');
  });

  it('re-acquire updates projectId', () => {
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'editing', 300, 'proj-a');
    registry.acquire('agent-1', 'developer', 'src/a.ts', 'still editing', 300, 'proj-a');
    const locks = registry.getAll();
    expect(locks).toHaveLength(1);
    expect(locks[0].projectId).toBe('proj-a');
    expect(locks[0].reason).toBe('still editing');
  });
});

// ── ActivityLedger Project Scoping ───────────────────────────────────

describe('ActivityLedger project scoping', () => {
  let db: Database;
  let ledger: ActivityLedger;

  beforeEach(() => {
    db = new Database(':memory:');
    ledger = new ActivityLedger(db);
  });

  afterEach(() => {
    ledger.stop();
    db.close();
  });

  it('log stores projectId', () => {
    const entry = ledger.log('agent-1', 'developer', 'file_edit', 'Edited file', {}, 'proj-a');
    expect(entry.projectId).toBe('proj-a');
  });

  it('getRecent with projectId filter', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'Proj A edit', {}, 'proj-a');
    ledger.log('agent-2', 'reviewer', 'file_read', 'Proj B read', {}, 'proj-b');
    ledger.log('agent-3', 'developer', 'task_completed', 'Proj A done', {}, 'proj-a');

    const projA = ledger.getRecent(50, 'proj-a');
    expect(projA).toHaveLength(2);
    expect(projA.every(e => e.projectId === 'proj-a')).toBe(true);

    const projB = ledger.getRecent(50, 'proj-b');
    expect(projB).toHaveLength(1);
    expect(projB[0].projectId).toBe('proj-b');
  });

  it('getRecent without projectId returns all entries', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A', {}, 'proj-a');
    ledger.log('agent-2', 'reviewer', 'file_read', 'B', {}, 'proj-b');
    expect(ledger.getRecent(50)).toHaveLength(2);
  });

  it('getByAgent with projectId filter', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A edit', {}, 'proj-a');
    ledger.log('agent-1', 'developer', 'file_read', 'B read', {}, 'proj-b');
    ledger.log('agent-1', 'developer', 'task_completed', 'A done', {}, 'proj-a');

    const projA = ledger.getByAgent('agent-1', 50, 'proj-a');
    expect(projA).toHaveLength(2);
    expect(projA.every(e => e.projectId === 'proj-a')).toBe(true);
  });

  it('getByType with projectId filter', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A edit', {}, 'proj-a');
    ledger.log('agent-2', 'reviewer', 'file_edit', 'B edit', {}, 'proj-b');

    const projA = ledger.getByType('file_edit', 50, 'proj-a');
    expect(projA).toHaveLength(1);
    expect(projA[0].agentId).toBe('agent-1');
  });

  it('getSince with projectId filter', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A', {}, 'proj-a');
    ledger.log('agent-2', 'reviewer', 'file_read', 'B', {}, 'proj-b');

    const projA = ledger.getSince('2000-01-01 00:00:00', 'proj-a');
    expect(projA).toHaveLength(1);
    expect(projA[0].projectId).toBe('proj-a');
  });

  it('getSummary with projectId filter', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A edit', { file: 'src/a.ts' }, 'proj-a');
    ledger.log('agent-2', 'reviewer', 'file_edit', 'B edit', { file: 'src/b.ts' }, 'proj-b');
    ledger.log('agent-1', 'developer', 'task_completed', 'A done', {}, 'proj-a');

    const summary = ledger.getSummary('proj-a');
    expect(summary.totalActions).toBe(2);
    expect(Object.keys(summary.byAgent)).toEqual(['agent-1']);
    expect(summary.byType['file_edit']).toBe(1);
    expect(summary.byType['task_completed']).toBe(1);
    expect(summary.recentFiles).toEqual(['src/a.ts']);
  });

  it('getSummary without projectId returns all entries', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A', {}, 'proj-a');
    ledger.log('agent-2', 'reviewer', 'file_read', 'B', {}, 'proj-b');

    const summary = ledger.getSummary();
    expect(summary.totalActions).toBe(2);
  });

  it('projectId defaults to empty string when not specified', () => {
    const entry = ledger.log('agent-1', 'developer', 'file_edit', 'No project');
    expect(entry.projectId).toBe('');
  });

  it('projectId is preserved in retrieved entries', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'Test', {}, 'proj-x');
    const entries = ledger.getRecent(1);
    expect(entries[0].projectId).toBe('proj-x');
  });
});

// ── CollectiveMemory Project Scoping ─────────────────────────────────

describe('CollectiveMemory project scoping', () => {
  let db: Database;
  let memory: CollectiveMemory;

  beforeEach(() => {
    db = new Database(':memory:');
    memory = new CollectiveMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  it('remember stores projectId on the entry', () => {
    const entry = memory.remember('gotcha', 'test-key', 'test-value', 'agent-1', 'proj-a');
    expect(entry.projectId).toBe('proj-a');
  });

  it('same category+key can exist in different projects', () => {
    memory.remember('gotcha', 'test-key', 'value-a', 'agent-1', 'proj-a');
    memory.remember('gotcha', 'test-key', 'value-b', 'agent-2', 'proj-b');

    const all = memory.getAll();
    expect(all).toHaveLength(2);
    expect(all.map(e => e.value).sort()).toEqual(['value-a', 'value-b']);
  });

  it('upsert is scoped per project', () => {
    memory.remember('pattern', 'test', 'v1', 'agent-1', 'proj-a');
    memory.remember('pattern', 'test', 'v2', 'agent-1', 'proj-a');

    // Same project, same key — should upsert (1 entry)
    const projA = memory.getAll('proj-a');
    expect(projA).toHaveLength(1);
    expect(projA[0].value).toBe('v2');
    expect(projA[0].useCount).toBe(1);

    // Different project — should be separate entry
    memory.remember('pattern', 'test', 'v3', 'agent-2', 'proj-b');
    expect(memory.getAll()).toHaveLength(2);
  });

  it('recall filters by project', () => {
    memory.remember('gotcha', 'key-a', 'val-a', 'agent-1', 'proj-a');
    memory.remember('gotcha', 'key-b', 'val-b', 'agent-2', 'proj-b');

    const projA = memory.recall('gotcha', undefined, 'proj-a');
    expect(projA).toHaveLength(1);
    expect(projA[0].key).toBe('key-a');
  });

  it('recall without project returns all entries', () => {
    memory.remember('gotcha', 'key-a', 'val-a', 'agent-1', 'proj-a');
    memory.remember('gotcha', 'key-b', 'val-b', 'agent-2', 'proj-b');

    const all = memory.recall('gotcha');
    expect(all).toHaveLength(2);
  });

  it('recallForFile filters by project', () => {
    memory.remember('expertise', 'file:src/index.ts', 'entry point', 'a1', 'proj-a');
    memory.remember('expertise', 'file:src/index.ts', 'different entry', 'a2', 'proj-b');

    const projA = memory.recallForFile('src/index.ts', 'proj-a');
    expect(projA).toHaveLength(1);
    expect(projA[0].source).toBe('a1');
  });

  it('getAll filters by project', () => {
    memory.remember('pattern', 'a', 'val', 'a1', 'proj-a');
    memory.remember('pattern', 'b', 'val', 'a2', 'proj-b');
    memory.remember('gotcha', 'c', 'val', 'a1', 'proj-a');

    const projA = memory.getAll('proj-a');
    expect(projA).toHaveLength(2);
    expect(projA.every(e => e.projectId === 'proj-a')).toBe(true);
  });

  it('prune scopes to project', () => {
    memory.remember('gotcha', 'old-a', 'stale', 'a1', 'proj-a');
    memory.remember('gotcha', 'old-b', 'stale', 'a2', 'proj-b');

    // Prune only proj-a (maxAge=0 removes all)
    const removed = memory.prune(0, 'proj-a');
    expect(removed).toBe(1);
    expect(memory.getAll()).toHaveLength(1);
    expect(memory.getAll()[0].projectId).toBe('proj-b');
  });

  it('prune without project removes from all projects', () => {
    memory.remember('gotcha', 'old-a', 'stale', 'a1', 'proj-a');
    memory.remember('gotcha', 'old-b', 'stale', 'a2', 'proj-b');

    const removed = memory.prune(0);
    expect(removed).toBe(2);
    expect(memory.getAll()).toHaveLength(0);
  });

  it('projectId defaults to empty string when not specified', () => {
    const entry = memory.remember('gotcha', 'test', 'value', 'agent-1');
    expect(entry.projectId).toBe('');
  });

  it('forget removes by id regardless of project', () => {
    const entry = memory.remember('gotcha', 'temp', 'temporary', 'a1', 'proj-a');
    expect(memory.forget(entry.id)).toBe(true);
    expect(memory.getAll()).toHaveLength(0);
  });
});
