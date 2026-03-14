import { join, dirname } from 'path';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import YAML from 'yaml';
import type { ProjectMetadata, StorageMode, SyncManifest } from './types.js';
import { PROJECT_SUBDIRS, SYNC_SCHEMA_VERSION } from './types.js';
import { logger } from '../utils/logger.js';
import { FLIGHTDECK_STATE_DIR } from '../config.js';

/** Default root for user-mode storage */
const USER_STORAGE_ROOT = join(FLIGHTDECK_STATE_DIR, 'projects');

/**
 * Manages the filesystem mirror for project state.
 * Handles path resolution, directory creation, and YAML read/write.
 */
export class StorageManager {
  /** Root directory override for testing */
  private userRoot: string;
  /** Per-project storage mode overrides (local mode uses git root) */
  private modeOverrides = new Map<string, { mode: StorageMode; localRoot: string }>();

  constructor(options?: { userRoot?: string }) {
    this.userRoot = options?.userRoot ?? USER_STORAGE_ROOT;
  }

  /**
   * Set storage mode for a specific project.
   * 'local' mode stores files under `<gitRoot>/.flightdeck/projects/<id>/`.
   */
  setStorageMode(projectId: string, mode: StorageMode, gitRoot?: string): void {
    if (mode === 'local') {
      if (!gitRoot) throw new Error('gitRoot is required for local storage mode');
      this.modeOverrides.set(projectId, {
        mode,
        localRoot: join(gitRoot, '.flightdeck', 'projects'),
      });
    } else {
      this.modeOverrides.delete(projectId);
    }
  }

  /** Get the storage mode for a project ('user' by default). */
  getStorageMode(projectId: string): StorageMode {
    return this.modeOverrides.get(projectId)?.mode ?? 'user';
  }

  /** Resolve the root directory for a specific project's filesystem mirror. */
  getProjectDir(projectId: string): string {
    validatePathSegment(projectId, 'projectId');
    const override = this.modeOverrides.get(projectId);
    const root = override?.localRoot ?? this.userRoot;
    return join(root, projectId);
  }

  /**
   * Create the full directory structure for a project.
   * Idempotent — safe to call multiple times.
   */
  ensureProjectDirs(projectId: string): string {
    const projectDir = this.getProjectDir(projectId);
    for (const sub of PROJECT_SUBDIRS) {
      mkdirSync(join(projectDir, sub), { recursive: true });
    }
    return projectDir;
  }

  /** Read project.yaml for a given project. Returns undefined if not found. */
  readProjectYaml(projectId: string): ProjectMetadata | undefined {
    const filePath = join(this.getProjectDir(projectId), 'project.yaml');
    if (!existsSync(filePath)) return undefined;
    try {
      const content = readFileSync(filePath, 'utf-8');
      return YAML.parse(content) as ProjectMetadata;
    } catch (err) {
      logger.warn({ module: 'storage', msg: 'Failed to read project.yaml', projectId, err: (err as Error).message });
      return undefined;
    }
  }

  /** Write project.yaml atomically (temp file + rename). */
  writeProjectYaml(projectId: string, data: ProjectMetadata): void {
    const filePath = join(this.getProjectDir(projectId), 'project.yaml');
    atomicWriteFile(filePath, YAML.stringify(data, { lineWidth: 0 }));
  }

  /** Read the sync manifest for a project. Returns a fresh manifest if not found. */
  readSyncManifest(projectId: string): SyncManifest {
    const filePath = join(this.getProjectDir(projectId), '.sync-manifest.json');
    if (!existsSync(filePath)) {
      return { lastSyncedAt: '', files: {}, schemaVersion: SYNC_SCHEMA_VERSION };
    }
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as SyncManifest;
    } catch {
      return { lastSyncedAt: '', files: {}, schemaVersion: SYNC_SCHEMA_VERSION };
    }
  }

  /** Write the sync manifest atomically. */
  writeSyncManifest(projectId: string, manifest: SyncManifest): void {
    const filePath = join(this.getProjectDir(projectId), '.sync-manifest.json');
    atomicWriteFile(filePath, JSON.stringify(manifest, null, 2));
  }
}

/**
 * Atomic file write: write to a temp file in the same directory, then rename.
 * `rename()` is atomic on the same filesystem (POSIX guarantee).
 */
export function atomicWriteFile(targetPath: string, content: string): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, targetPath);
}

/**
 * Validate that a path segment (e.g., projectId) does not contain
 * path traversal characters or OS-specific separators.
 */
function validatePathSegment(segment: string, label: string): void {
  if (!segment || /[/\\]/.test(segment) || segment === '..' || segment === '.') {
    throw new Error(`Invalid ${label}: path traversal detected in '${segment}'`);
  }
}


