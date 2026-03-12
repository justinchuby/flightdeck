import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import YAML from 'yaml';
import { StorageManager, atomicWriteFile } from '../StorageManager.js';
import { validatePathWithinDir } from '../../utils/pathValidation.js';
import type { ProjectMetadata } from '../types.js';
import { PROJECT_SUBDIRS } from '../types.js';

let tempDir: string;
let manager: StorageManager;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'flightdeck-storage-'));
  manager = new StorageManager({ userRoot: tempDir });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('StorageManager', () => {
  describe('getProjectDir', () => {
    it('returns user-mode path by default', () => {
      expect(manager.getProjectDir('my-project-a3f7'))
        .toBe(join(tempDir, 'my-project-a3f7'));
    });

    it('returns local-mode path when configured', () => {
      manager.setStorageMode('proj-1234', 'local', '/repo');
      expect(manager.getProjectDir('proj-1234'))
        .toBe(join('/repo', '.flightdeck', 'projects', 'proj-1234'));
    });

    it('reverts to user-mode when set back', () => {
      manager.setStorageMode('proj-1234', 'local', '/repo');
      manager.setStorageMode('proj-1234', 'user');
      expect(manager.getProjectDir('proj-1234'))
        .toBe(join(tempDir, 'proj-1234'));
    });
  });

  describe('getStorageMode', () => {
    it('defaults to user', () => {
      expect(manager.getStorageMode('any-project')).toBe('user');
    });

    it('returns local when set', () => {
      manager.setStorageMode('proj-1234', 'local', '/repo');
      expect(manager.getStorageMode('proj-1234')).toBe('local');
    });
  });

  describe('setStorageMode', () => {
    it('throws if local mode without gitRoot', () => {
      expect(() => manager.setStorageMode('proj', 'local')).toThrow('gitRoot is required');
    });
  });

  describe('ensureProjectDirs', () => {
    it('creates project directory and all subdirectories', () => {
      const dir = manager.ensureProjectDirs('test-proj-0001');
      expect(existsSync(dir)).toBe(true);
      for (const sub of PROJECT_SUBDIRS) {
        expect(existsSync(join(dir, sub))).toBe(true);
      }
    });

    it('is idempotent', () => {
      manager.ensureProjectDirs('test-proj-0001');
      manager.ensureProjectDirs('test-proj-0001');
      expect(existsSync(manager.getProjectDir('test-proj-0001'))).toBe(true);
    });
  });

  describe('readProjectYaml / writeProjectYaml', () => {
    const metadata: ProjectMetadata = {
      title: 'My Project',
      id: 'my-project-a3f7',
      workingDir: '/path/to/repo',
      storageMode: 'user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-07T15:00:00Z',
    };

    it('returns undefined when project.yaml does not exist', () => {
      expect(manager.readProjectYaml('nonexistent')).toBeUndefined();
    });

    it('round-trips project metadata through YAML', () => {
      manager.ensureProjectDirs(metadata.id);
      manager.writeProjectYaml(metadata.id, metadata);
      const read = manager.readProjectYaml(metadata.id);
      expect(read).toEqual(metadata);
    });

    it('writes valid YAML format', () => {
      manager.ensureProjectDirs(metadata.id);
      manager.writeProjectYaml(metadata.id, metadata);
      const raw = readFileSync(join(manager.getProjectDir(metadata.id), 'project.yaml'), 'utf-8');
      const parsed = YAML.parse(raw);
      expect(parsed.title).toBe('My Project');
      expect(parsed.id).toBe('my-project-a3f7');
    });
  });

  describe('readSyncManifest / writeSyncManifest', () => {
    it('returns fresh manifest when none exists', () => {
      const manifest = manager.readSyncManifest('test-proj');
      expect(manifest.lastSyncedAt).toBe('');
      expect(manifest.files).toEqual({});
      expect(manifest.schemaVersion).toBe(1);
    });

    it('round-trips manifest data', () => {
      manager.ensureProjectDirs('test-proj');
      const manifest = {
        lastSyncedAt: '2026-03-07T15:00:00Z',
        files: { 'project.yaml': 'abc123', 'agents/roster.yaml': 'def456' },
        schemaVersion: 1,
      };
      manager.writeSyncManifest('test-proj', manifest);
      expect(manager.readSyncManifest('test-proj')).toEqual(manifest);
    });
  });
});

describe('atomicWriteFile', () => {
  it('writes content to the target path', () => {
    const target = join(tempDir, 'atomic-test.txt');
    atomicWriteFile(target, 'hello world');
    expect(readFileSync(target, 'utf-8')).toBe('hello world');
  });

  it('creates parent directories if needed', () => {
    const target = join(tempDir, 'deep', 'nested', 'file.txt');
    atomicWriteFile(target, 'content');
    expect(readFileSync(target, 'utf-8')).toBe('content');
  });

  it('does not leave temp files on success', () => {
    const target = join(tempDir, 'clean.txt');
    atomicWriteFile(target, 'data');
    const files = require('fs').readdirSync(tempDir);
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('overwrites existing files', () => {
    const target = join(tempDir, 'overwrite.txt');
    atomicWriteFile(target, 'first');
    atomicWriteFile(target, 'second');
    expect(readFileSync(target, 'utf-8')).toBe('second');
  });
});

describe('path traversal protection', () => {
  let storage: StorageManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'storage-sec-'));
    storage = new StorageManager({ userRoot: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects projectId with path separators', () => {
    expect(() => storage.getProjectDir('../escape')).toThrow(/path traversal/);
    expect(() => storage.getProjectDir('foo/bar')).toThrow(/path traversal/);
    expect(() => storage.getProjectDir('foo\\bar')).toThrow(/path traversal/);
  });

  it('rejects ".." as projectId', () => {
    expect(() => storage.getProjectDir('..')).toThrow(/path traversal/);
  });

  it('rejects "." as projectId', () => {
    expect(() => storage.getProjectDir('.')).toThrow(/path traversal/);
  });

  it('rejects empty projectId', () => {
    expect(() => storage.getProjectDir('')).toThrow(/path traversal/);
  });

  it('allows valid projectId with hyphens and alphanumeric', () => {
    expect(() => storage.getProjectDir('my-project-a1b2')).not.toThrow();
  });
});

describe('validatePathWithinDir', () => {
  it('allows paths within parent directory', () => {
    const result = validatePathWithinDir('/projects/my-proj', 'knowledge/core/rules.md');
    expect(result).toBe('/projects/my-proj/knowledge/core/rules.md');
  });

  it('rejects paths that escape via ../', () => {
    expect(() => validatePathWithinDir('/projects/my-proj', '../../../etc/passwd')).toThrow(/Path traversal/);
  });

  it('rejects paths that escape via absolute path', () => {
    expect(() => validatePathWithinDir('/projects/my-proj', '/etc/passwd')).toThrow(/Path traversal/);
  });

  it('allows deeply nested valid paths', () => {
    const result = validatePathWithinDir('/root', 'a/b/c/d.txt');
    expect(result).toBe('/root/a/b/c/d.txt');
  });
});
