import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictDetectionEngine,
  simpleGlobMatch,
  type FileLockInfo,
  type RecentEdit,
  type ConflictAlert,
  type ConflictDetectionConfig,
  type ConflictResolution,
} from '../coordination/decisions/ConflictDetectionEngine.js';

// ── Mock DB ───────────────────────────────────────────────────────

function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? undefined),
    setSetting: vi.fn((key: string, val: string) => { settings.set(key, val); }),
    drizzle: {} as any,
    raw: {} as any,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function lock(filePath: string, agentId: string, role = 'developer', taskId: string | null = null): FileLockInfo {
  return { filePath, agentId, role, taskId };
}

function edit(filePath: string, agentId: string, role = 'developer'): RecentEdit {
  return { filePath, agentId, role, timestamp: new Date().toISOString() };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('ConflictDetectionEngine', () => {
  let db: ReturnType<typeof createMockDb>;
  let engine: ConflictDetectionEngine;

  beforeEach(() => {
    db = createMockDb();
    engine = new ConflictDetectionEngine(db as any);
  });

  // ── Directory Overlap Detection ───────────────────────────────

  describe('detectDirectoryOverlap', () => {
    it('detects two agents in the same directory as high severity', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/middleware.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const dirConflicts = conflicts.filter(c => c.type === 'same_directory');
      expect(dirConflicts.length).toBeGreaterThanOrEqual(1);
      const high = dirConflicts.find(c => c.severity === 'high');
      expect(high).toBeDefined();
      expect(high!.agents[0].agentId).not.toBe(high!.agents[1].agentId);
    });

    it('detects agents in parent/child directories as medium severity', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/utils/helper.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const dirConflicts = conflicts.filter(c => c.type === 'same_directory');
      expect(dirConflicts.length).toBeGreaterThanOrEqual(1);
      // Should have at least a medium severity one
      const medium = dirConflicts.find(c => c.severity === 'medium');
      expect(medium).toBeDefined();
    });

    it('does not flag agents in completely different directories', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/models/user.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const dirConflicts = conflicts.filter(c => c.type === 'same_directory');
      expect(dirConflicts).toHaveLength(0);
    });

    it('does not flag a single agent in a directory', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/middleware.ts', 'agent-1'),
      ];
      const conflicts = engine.scan(locks, []);
      const dirConflicts = conflicts.filter(c => c.type === 'same_directory');
      expect(dirConflicts).toHaveLength(0);
    });

    it('creates pairwise conflicts for 3 agents in the same directory', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/a.ts', 'agent-1'),
        lock('src/auth/b.ts', 'agent-2'),
        lock('src/auth/c.ts', 'agent-3'),
      ];
      const conflicts = engine.scan(locks, []);
      const dirConflicts = conflicts.filter(c => c.type === 'same_directory');
      // 3 agents → 3 pairs: (1,2), (1,3), (2,3)
      expect(dirConflicts.length).toBeGreaterThanOrEqual(3);
    });

    it('populates agent role and taskId from lock info', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1', 'developer', 'task-1'),
        lock('src/auth/middleware.ts', 'agent-2', 'reviewer', 'task-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const c = conflicts.find(c => c.type === 'same_directory');
      expect(c).toBeDefined();
      const agents = c!.agents.sort((a, b) => a.agentId.localeCompare(b.agentId));
      expect(agents[0].role).toBe('developer');
      expect(agents[0].taskId).toBe('task-1');
      expect(agents[1].role).toBe('reviewer');
      expect(agents[1].taskId).toBe('task-2');
    });
  });

  // ── Import Overlap Detection ──────────────────────────────────

  describe('detectImportOverlap', () => {
    it('detects test file + source file in same directory', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/login.test.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts.length).toBeGreaterThanOrEqual(1);
      expect(importConflicts[0].severity).toBe('medium');
    });

    it('detects spec file + source file in same directory', () => {
      const locks: FileLockInfo[] = [
        lock('src/utils/format.ts', 'agent-1'),
        lock('src/utils/format.spec.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts.length).toBeGreaterThanOrEqual(1);
    });

    it('detects index.ts + other file in same directory', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/index.ts', 'agent-1'),
        lock('src/auth/middleware.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag unrelated files in the same directory', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/register.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts).toHaveLength(0);
    });

    it('uses recent edits to find import overlaps', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
      ];
      const edits: RecentEdit[] = [
        edit('src/auth/login.test.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, edits);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag same agent editing related files', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/login.test.ts', 'agent-1'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts).toHaveLength(0);
    });

    it('detects index.js and index.tsx variants', () => {
      const locks: FileLockInfo[] = [
        lock('src/components/index.tsx', 'agent-1'),
        lock('src/components/Button.tsx', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Lock Contention Detection ─────────────────────────────────

  describe('detectLockContention', () => {
    it('detects exact same file locked by two agents (high severity)', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const lockConflicts = conflicts.filter(c => c.type === 'lock_contention');
      expect(lockConflicts.length).toBeGreaterThanOrEqual(1);
      expect(lockConflicts[0].severity).toBe('high');
      expect(lockConflicts[0].files[0].risk).toBe('direct');
    });

    it('detects glob pattern overlap (medium severity)', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/*', 'agent-1'),
        lock('src/auth/login.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const lockConflicts = conflicts.filter(c => c.type === 'lock_contention');
      expect(lockConflicts.length).toBeGreaterThanOrEqual(1);
      expect(lockConflicts[0].severity).toBe('medium');
    });

    it('detects ** glob pattern overlap', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/**', 'agent-1'),
        lock('src/auth/utils/helper.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const lockConflicts = conflicts.filter(c => c.type === 'lock_contention');
      expect(lockConflicts.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag non-overlapping locks', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/models/user.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const lockConflicts = conflicts.filter(c => c.type === 'lock_contention');
      expect(lockConflicts).toHaveLength(0);
    });

    it('does not flag same agent locking multiple files', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-1'),
      ];
      const conflicts = engine.scan(locks, []);
      const lockConflicts = conflicts.filter(c => c.type === 'lock_contention');
      expect(lockConflicts).toHaveLength(0);
    });

    it('does not match * across directory boundaries', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/*', 'agent-1'),
        lock('src/auth/utils/helper.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const lockConflicts = conflicts.filter(c => c.type === 'lock_contention');
      expect(lockConflicts).toHaveLength(0);
    });
  });

  // ── Conflict Merging ──────────────────────────────────────────

  describe('mergeConflicts', () => {
    it('deduplicates conflicts by key on repeated scans', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];

      const first = engine.scan(locks, []);
      expect(first.length).toBeGreaterThan(0);

      const second = engine.scan(locks, []);
      // Second scan should not create new conflicts (already exists)
      expect(second).toHaveLength(0);

      // But total active should still be > 0
      expect(engine.getConflicts().length).toBeGreaterThan(0);
    });

    it('does not re-create resolved conflicts', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];

      const first = engine.scan(locks, []);
      expect(first.length).toBeGreaterThan(0);

      // Resolve the conflict
      const id = first[0].id;
      engine.resolve(id, { type: 'merged', by: 'agent-1' });

      // Scan again — should not re-create
      const second = engine.scan(locks, []);
      expect(second).toHaveLength(0);
    });

    it('does not re-create dismissed conflicts', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];

      const first = engine.scan(locks, []);
      engine.dismiss(first[0].id);

      const second = engine.scan(locks, []);
      expect(second).toHaveLength(0);
    });
  });

  // ── Resolution and Dismissal ──────────────────────────────────

  describe('resolve', () => {
    it('marks a conflict as resolved', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const active = engine.getConflicts();
      expect(active.length).toBeGreaterThan(0);

      const resolution: ConflictResolution = { type: 'sequenced', order: ['agent-1', 'agent-2'] };
      const result = engine.resolve(active[0].id, resolution);
      expect(result).toBe(true);

      const conflict = engine.getConflict(active[0].id);
      expect(conflict!.status).toBe('resolved');
      expect(conflict!.resolution).toEqual(resolution);
    });

    it('returns false for non-existent conflict', () => {
      expect(engine.resolve('nonexistent', { type: 'merged', by: 'test' })).toBe(false);
    });

    it('returns false for already-resolved conflict', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const id = engine.getConflicts()[0].id;
      engine.resolve(id, { type: 'merged', by: 'test' });
      expect(engine.resolve(id, { type: 'merged', by: 'test2' })).toBe(false);
    });

    it('removes resolved conflict from getConflicts() but keeps in getAllConflicts()', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const id = engine.getConflicts()[0].id;
      engine.resolve(id, { type: 'auto_resolved', method: 'lock_release' });

      expect(engine.getConflicts().find(c => c.id === id)).toBeUndefined();
      expect(engine.getAllConflicts().find(c => c.id === id)).toBeDefined();
    });
  });

  describe('dismiss', () => {
    it('marks a conflict as dismissed', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const id = engine.getConflicts()[0].id;

      expect(engine.dismiss(id)).toBe(true);
      expect(engine.getConflict(id)!.status).toBe('dismissed');
      expect(engine.getConflict(id)!.resolution).toEqual({ type: 'dismissed', by: 'user' });
    });

    it('returns false for non-existent conflict', () => {
      expect(engine.dismiss('nonexistent')).toBe(false);
    });

    it('returns false for already-dismissed conflict', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const id = engine.getConflicts()[0].id;
      engine.dismiss(id);
      expect(engine.dismiss(id)).toBe(false);
    });
  });

  // ── Config ────────────────────────────────────────────────────

  describe('config', () => {
    it('returns default config', () => {
      const config = engine.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.checkIntervalMs).toBe(15000);
      expect(config.directoryOverlapEnabled).toBe(true);
      expect(config.importAnalysisEnabled).toBe(true);
      expect(config.branchDivergenceEnabled).toBe(true);
    });

    it('updates partial config', () => {
      const updated = engine.updateConfig({ checkIntervalMs: 30000 });
      expect(updated.checkIntervalMs).toBe(30000);
      expect(updated.enabled).toBe(true); // unchanged
    });

    it('persists config to db', () => {
      engine.updateConfig({ enabled: false });
      expect(db.setSetting).toHaveBeenCalledWith(
        'conflict_config',
        expect.any(String),
      );
      const savedJson = db.setSetting.mock.calls.find(
        (c: [string, string]) => c[0] === 'conflict_config'
      );
      expect(savedJson).toBeDefined();
      const parsed = JSON.parse(savedJson![1]);
      expect(parsed.enabled).toBe(false);
    });

    it('loads saved config on construction', () => {
      const config: ConflictDetectionConfig = {
        enabled: false,
        checkIntervalMs: 5000,
        directoryOverlapEnabled: false,
        importAnalysisEnabled: true,
        branchDivergenceEnabled: false,
      };
      db.setSetting('conflict_config', JSON.stringify(config));
      const engine2 = new ConflictDetectionEngine(db as any);
      expect(engine2.getConfig().enabled).toBe(false);
      expect(engine2.getConfig().checkIntervalMs).toBe(5000);
    });

    it('disabling engine returns no conflicts from scan', () => {
      engine.updateConfig({ enabled: false });
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      expect(conflicts).toHaveLength(0);
    });

    it('disabling directory overlap skips that detector', () => {
      engine.updateConfig({ directoryOverlapEnabled: false });
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/middleware.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const dirConflicts = conflicts.filter(c => c.type === 'same_directory');
      expect(dirConflicts).toHaveLength(0);
    });

    it('disabling import analysis skips that detector', () => {
      engine.updateConfig({ importAnalysisEnabled: false });
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/login.test.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const importConflicts = conflicts.filter(c => c.type === 'import_overlap');
      expect(importConflicts).toHaveLength(0);
    });
  });

  // ── Persistence ───────────────────────────────────────────────

  describe('persistence', () => {
    it('saves conflicts to db after scan', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      expect(db.setSetting).toHaveBeenCalledWith('conflicts', expect.any(String));
    });

    it('loads saved conflicts on construction', () => {
      const conflict: ConflictAlert = {
        id: 'conflict-saved-1',
        type: 'lock_contention',
        severity: 'high',
        agents: [
          { agentId: 'agent-1', role: 'dev', files: ['src/x.ts'], taskId: null },
          { agentId: 'agent-2', role: 'dev', files: ['src/x.ts'], taskId: null },
        ],
        files: [{ path: 'src/x.ts', agents: ['agent-1', 'agent-2'], editType: 'locked', risk: 'direct' }],
        description: 'test conflict',
        detectedAt: new Date().toISOString(),
        status: 'active',
      };
      db.setSetting('conflicts', JSON.stringify([conflict]));

      const engine2 = new ConflictDetectionEngine(db as any);
      expect(engine2.getConflict('conflict-saved-1')).toBeDefined();
      expect(engine2.getConflicts()).toHaveLength(1);
    });

    it('persists after resolve', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const id = engine.getConflicts()[0].id;
      db.setSetting.mockClear();

      engine.resolve(id, { type: 'merged', by: 'test' });
      expect(db.setSetting).toHaveBeenCalledWith('conflicts', expect.any(String));
    });

    it('persists after dismiss', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      engine.scan(locks, []);
      const id = engine.getConflicts()[0].id;
      db.setSetting.mockClear();

      engine.dismiss(id);
      expect(db.setSetting).toHaveBeenCalledWith('conflicts', expect.any(String));
    });

    it('handles corrupt saved data gracefully', () => {
      db.setSetting('conflicts', 'not-valid-json');
      const engine2 = new ConflictDetectionEngine(db as any);
      expect(engine2.getConflicts()).toHaveLength(0);
    });

    it('handles corrupt config data gracefully', () => {
      db.setSetting('conflict_config', '{bad json');
      const engine2 = new ConflictDetectionEngine(db as any);
      // Should fall back to defaults
      expect(engine2.getConfig().enabled).toBe(true);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty for empty locks', () => {
      const conflicts = engine.scan([], []);
      expect(conflicts).toHaveLength(0);
    });

    it('returns empty for single agent locks', () => {
      const locks: FileLockInfo[] = [
        lock('src/auth/login.ts', 'agent-1'),
        lock('src/auth/middleware.ts', 'agent-1'),
        lock('src/models/user.ts', 'agent-1'),
      ];
      const conflicts = engine.scan(locks, []);
      expect(conflicts).toHaveLength(0);
    });

    it('handles missing role gracefully', () => {
      const locks: FileLockInfo[] = [
        { filePath: 'src/index.ts', agentId: 'agent-1' },
        { filePath: 'src/index.ts', agentId: 'agent-2' },
      ];
      const conflicts = engine.scan(locks, []);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].agents[0].role).toBe('unknown');
    });

    it('conflict IDs follow expected format', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      expect(conflicts[0].id).toMatch(/^conflict-\d+-[a-z0-9]+$/);
    });

    it('detectedAt is a valid ISO date string', () => {
      const locks: FileLockInfo[] = [
        lock('src/index.ts', 'agent-1'),
        lock('src/index.ts', 'agent-2'),
      ];
      const conflicts = engine.scan(locks, []);
      const date = new Date(conflicts[0].detectedAt);
      expect(date.getTime()).not.toBeNaN();
    });

    it('scan returns only newly created conflicts', () => {
      const locks1: FileLockInfo[] = [
        lock('src/a.ts', 'agent-1'),
        lock('src/a.ts', 'agent-2'),
      ];
      const first = engine.scan(locks1, []);
      expect(first.length).toBeGreaterThan(0);

      // Add a new conflict pair while keeping old one
      const locks2: FileLockInfo[] = [
        lock('src/a.ts', 'agent-1'),
        lock('src/a.ts', 'agent-2'),
        lock('src/b.ts', 'agent-1'),
        lock('src/b.ts', 'agent-3'),
      ];
      const second = engine.scan(locks2, []);
      // Should only contain the new agent-1/agent-3 conflicts
      for (const c of second) {
        const agentIds = c.agents.map(a => a.agentId).sort();
        // Should not be the old agent-1/agent-2 pair for lock_contention of src/a.ts
        if (c.type === 'lock_contention') {
          expect(agentIds).not.toEqual(['agent-1', 'agent-2']);
        }
      }
    });

    it('handles files with no directory separator', () => {
      const locks: FileLockInfo[] = [
        lock('README.md', 'agent-1'),
        lock('LICENSE', 'agent-2'),
      ];
      // Should not throw
      const conflicts = engine.scan(locks, []);
      // Both in root "." directory — may or may not flag depending on detection
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });

  // ── simpleGlobMatch ───────────────────────────────────────────

  describe('simpleGlobMatch', () => {
    it('matches exact paths', () => {
      expect(simpleGlobMatch('src/index.ts', 'src/index.ts')).toBe(true);
    });

    it('does not match different paths', () => {
      expect(simpleGlobMatch('src/index.ts', 'src/other.ts')).toBe(false);
    });

    it('matches * glob for files in same directory', () => {
      expect(simpleGlobMatch('src/auth/*', 'src/auth/login.ts')).toBe(true);
    });

    it('does not match * glob across directory boundaries', () => {
      expect(simpleGlobMatch('src/auth/*', 'src/auth/utils/helper.ts')).toBe(false);
    });

    it('matches ** glob across directory boundaries', () => {
      expect(simpleGlobMatch('src/auth/**', 'src/auth/utils/helper.ts')).toBe(true);
    });

    it('matches *.ts glob for .ts files', () => {
      expect(simpleGlobMatch('src/auth/*.ts', 'src/auth/login.ts')).toBe(true);
    });

    it('does not match *.ts glob for .js files', () => {
      expect(simpleGlobMatch('src/auth/*.ts', 'src/auth/login.js')).toBe(false);
    });

    it('pattern matches itself', () => {
      expect(simpleGlobMatch('src/auth/*', 'src/auth/*')).toBe(true);
    });
  });
});
