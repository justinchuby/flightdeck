import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import YAML from 'yaml';
import { StorageManager } from '../StorageManager.js';
import { SyncEngine } from '../SyncEngine.js';
import type { SyncDataProvider } from '../SyncEngine.js';

let tempDir: string;
let storage: StorageManager;

function createMockProvider(overrides?: Partial<SyncDataProvider>): SyncDataProvider {
  return {
    getActiveProjectIds: () => ['test-proj-a1b2'],
    getProject: (id) => ({
      id,
      name: 'Test Project',
      cwd: '/test/repo',
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-07T15:00:00Z',
    }),
    getAgentRoster: () => [
      { id: 'agent-1', role: 'lead', status: 'running', model: 'claude-sonnet-4', task: 'Build the app' },
      { id: 'agent-2', role: 'developer', status: 'idle', task: 'Implement feature X' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'flightdeck-sync-'));
  storage = new StorageManager({ userRoot: tempDir });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SyncEngine', () => {
  describe('syncNow', () => {
    it('creates project directory and writes project.yaml', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      const synced = engine.syncNow();

      expect(synced).toBe(1);
      const projectDir = storage.getProjectDir('test-proj-a1b2');
      expect(existsSync(join(projectDir, 'project.yaml'))).toBe(true);

      const yaml = YAML.parse(readFileSync(join(projectDir, 'project.yaml'), 'utf-8'));
      expect(yaml.title).toBe('Test Project');
      expect(yaml.id).toBe('test-proj-a1b2');
      expect(yaml.workingDir).toBe('/test/repo');
      expect(yaml.storageMode).toBe('user');
    });

    it('writes agents/roster.yaml', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      const projectDir = storage.getProjectDir('test-proj-a1b2');
      const roster = YAML.parse(readFileSync(join(projectDir, 'agents', 'roster.yaml'), 'utf-8'));
      expect(roster.agents).toHaveLength(2);
      expect(roster.agents[0].role).toBe('lead');
      expect(roster.agents[1].role).toBe('developer');
    });

    it('writes sync manifest', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      const manifest = storage.readSyncManifest('test-proj-a1b2');
      expect(manifest.lastSyncedAt).toBeTruthy();
      expect(manifest.files['project.yaml']).toBeTruthy();
      expect(manifest.files['agents/roster.yaml']).toBeTruthy();
      expect(manifest.schemaVersion).toBe(1);
    });

    it('skips write when content has not changed', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      // Read the file after first sync
      const projectDir = storage.getProjectDir('test-proj-a1b2');
      const firstContent = readFileSync(join(projectDir, 'project.yaml'), 'utf-8');

      // Sync again — content unchanged, should not rewrite
      engine.syncNow();
      const secondContent = readFileSync(join(projectDir, 'project.yaml'), 'utf-8');
      expect(secondContent).toBe(firstContent);
    });

    it('rewrites when content changes', () => {
      let projectName = 'Original Name';
      const provider = createMockProvider({
        getProject: (id) => ({
          id,
          name: projectName,
          cwd: '/test',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-03-07T15:00:00Z',
        }),
      });

      const engine = new SyncEngine(storage, provider);
      engine.syncNow();

      const projectDir = storage.getProjectDir('test-proj-a1b2');
      const first = YAML.parse(readFileSync(join(projectDir, 'project.yaml'), 'utf-8'));
      expect(first.title).toBe('Original Name');

      // Change data
      projectName = 'Updated Name';
      engine.syncNow();

      const second = YAML.parse(readFileSync(join(projectDir, 'project.yaml'), 'utf-8'));
      expect(second.title).toBe('Updated Name');
    });

    it('handles multiple projects', () => {
      const provider = createMockProvider({
        getActiveProjectIds: () => ['proj-a', 'proj-b'],
      });
      const engine = new SyncEngine(storage, provider);
      const synced = engine.syncNow();

      expect(synced).toBe(2);
      expect(existsSync(storage.getProjectDir('proj-a'))).toBe(true);
      expect(existsSync(storage.getProjectDir('proj-b'))).toBe(true);
    });

    it('continues syncing other projects if one fails', () => {
      let _callCount = 0;
      const provider = createMockProvider({
        getActiveProjectIds: () => ['proj-good', 'proj-bad', 'proj-good2'],
        getProject: (id) => {
          _callCount++;
          if (id === 'proj-bad') throw new Error('DB error');
          return {
            id, name: 'Good', cwd: null, status: 'active',
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          };
        },
      });
      const engine = new SyncEngine(storage, provider);
      const synced = engine.syncNow();
      expect(synced).toBe(2); // proj-good + proj-good2
    });

    it('handles project with no agents gracefully', () => {
      const provider = createMockProvider({ getAgentRoster: () => [] });
      const engine = new SyncEngine(storage, provider);
      engine.syncNow();

      const projectDir = storage.getProjectDir('test-proj-a1b2');
      const roster = YAML.parse(readFileSync(join(projectDir, 'agents', 'roster.yaml'), 'utf-8'));
      expect(roster.agents).toEqual([]);
    });
  });

  describe('startSync / stopSync', () => {
    it('starts and stops the sync loop', () => {
      vi.useFakeTimers();
      const provider = createMockProvider();
      const engine = new SyncEngine(storage, provider, { intervalMs: 1000 });

      expect(engine.isRunning).toBe(false);
      engine.startSync();
      expect(engine.isRunning).toBe(true);

      engine.stopSync();
      expect(engine.isRunning).toBe(false);
      vi.useRealTimers();
    });

    it('runs sync on interval', () => {
      vi.useFakeTimers();
      const getProject = vi.fn().mockReturnValue({
        id: 'test-proj-a1b2', name: 'Test', cwd: null, status: 'active',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      const provider = createMockProvider({ getProject });
      const engine = new SyncEngine(storage, provider, { intervalMs: 5000 });

      engine.startSync();
      expect(getProject).toHaveBeenCalledTimes(1); // initial sync

      vi.advanceTimersByTime(5000);
      expect(getProject).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5000);
      expect(getProject).toHaveBeenCalledTimes(3);

      engine.stopSync();
      vi.advanceTimersByTime(5000);
      expect(getProject).toHaveBeenCalledTimes(3); // no more calls

      vi.useRealTimers();
    });

    it('is idempotent for startSync', () => {
      vi.useFakeTimers();
      const provider = createMockProvider();
      const engine = new SyncEngine(storage, provider, { intervalMs: 1000 });

      engine.startSync();
      engine.startSync(); // should not create second timer
      expect(engine.isRunning).toBe(true);

      engine.stopSync();
      expect(engine.isRunning).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('reverseSync', () => {
    it('returns empty array when no files have changed', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      const modified = engine.reverseSync('test-proj-a1b2');
      expect(modified).toEqual([]);
    });

    it('detects user edits to project.yaml', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      // Simulate user edit
      const projectDir = storage.getProjectDir('test-proj-a1b2');
      const yamlPath = join(projectDir, 'project.yaml');
      writeFileSync(yamlPath, readFileSync(yamlPath, 'utf-8') + '\n# user comment\n');

      const modified = engine.reverseSync('test-proj-a1b2');
      expect(modified).toContain('project.yaml');
    });

    it('detects deleted files', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      // Delete roster.yaml
      const projectDir = storage.getProjectDir('test-proj-a1b2');
      require('fs').unlinkSync(join(projectDir, 'agents', 'roster.yaml'));

      const modified = engine.reverseSync('test-proj-a1b2');
      expect(modified).toContain('agents/roster.yaml');
    });

    it('returns empty when manifest has no files tracked', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      // Don't sync first — no manifest
      const modified = engine.reverseSync('test-proj-a1b2');
      expect(modified).toEqual([]);
    });

    it('throws on path traversal in manifest entries', () => {
      const engine = new SyncEngine(storage, createMockProvider());
      engine.syncNow();

      // Poison the manifest with a traversal path
      const _projectDir = storage.getProjectDir('test-proj-a1b2');
      const manifest = storage.readSyncManifest('test-proj-a1b2');
      manifest.files['../../../etc/passwd'] = 'deadbeef';
      storage.writeSyncManifest('test-proj-a1b2', manifest);

      expect(() => engine.reverseSync('test-proj-a1b2')).toThrow(/Path traversal/);
    });
  });

  describe('reentrancy guard', () => {
    it('returns 0 if sync is already running', () => {
      // Create a provider that calls syncNow() recursively
      const provider = createMockProvider();
      const originalGetIds = provider.getActiveProjectIds.bind(provider);
      let recursiveResult: number | undefined;

      const engine = new SyncEngine(storage, {
        ...provider,
        getActiveProjectIds() {
          // Attempt reentrant call during sync
          recursiveResult = engine.syncNow();
          return originalGetIds();
        },
      });

      engine.syncNow();
      expect(recursiveResult).toBe(0);
    });
  });

  describe('knowledge sync', () => {
    it('writes knowledge entries as markdown files', () => {
      const provider = createMockProvider({
        getKnowledge: () => [
          { category: 'core' as const, key: 'rules', content: 'Be concise', updatedAt: '2026-01-01T00:00:00Z' },
          { category: 'semantic' as const, key: 'stack', content: 'TypeScript + React', updatedAt: '2026-01-01T00:00:00Z' },
        ],
      });
      const engine = new SyncEngine(storage, provider);
      engine.syncNow();

      const projectDir = storage.getProjectDir('test-proj-a1b2');
      expect(existsSync(join(projectDir, 'knowledge', 'core', 'rules.md'))).toBe(true);
      expect(existsSync(join(projectDir, 'knowledge', 'semantic', 'stack.md'))).toBe(true);

      const content = readFileSync(join(projectDir, 'knowledge', 'core', 'rules.md'), 'utf-8');
      expect(content).toContain('Be concise');
      expect(content).toContain('category: core');
    });

    it('cleans up orphaned knowledge files when entries are deleted', () => {
      // First sync with an entry
      const entries = [
        { category: 'semantic' as const, key: 'fact', content: 'Old fact', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const provider = createMockProvider({
        getKnowledge: () => entries,
      });
      const engine = new SyncEngine(storage, provider);
      engine.syncNow();

      const projectDir = storage.getProjectDir('test-proj-a1b2');
      const filePath = join(projectDir, 'knowledge', 'semantic', 'fact.md');
      expect(existsSync(filePath)).toBe(true);

      // Second sync with entry removed — simulates deletion from DB
      entries.length = 0;
      engine.syncNow();

      // File should be deleted
      expect(existsSync(filePath)).toBe(false);

      // Manifest should not reference it
      const manifest = storage.readSyncManifest('test-proj-a1b2');
      expect(manifest.files['knowledge/semantic/fact.md']).toBeUndefined();
    });
  });
});
