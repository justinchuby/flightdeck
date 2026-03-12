import { createHash } from 'crypto';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import type { StorageManager } from './StorageManager.js';
import { atomicWriteFile } from './StorageManager.js';
import { validatePathWithinDir } from '../utils/pathValidation.js';
import type { ProjectMetadata, SyncManifest } from './types.js';
import { SYNC_SCHEMA_VERSION } from './types.js';
import { logger } from '../utils/logger.js';

import type { KnowledgeCategory } from '../knowledge/types.js';

/** A knowledge entry for sync purposes. */
export interface SyncKnowledgeEntry {
  category: KnowledgeCategory;
  key: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  updatedAt: string;
}

/** Data provider interface — abstracts SQLite reads for the sync engine. */
export interface SyncDataProvider {
  /** Get all active project IDs */
  getActiveProjectIds(): string[];
  /** Get project metadata by ID */
  getProject(id: string): { id: string; name: string; cwd: string | null; status: string; createdAt: string; updatedAt: string } | undefined;
  /** Get agents for a project (id, role, status) */
  getAgentRoster(projectId: string): Array<{ id: string; role: string; status: string; model?: string; task?: string }>;
  /** Get knowledge entries for a project (optional — if not provided, knowledge sync is skipped) */
  getKnowledge?(projectId: string): SyncKnowledgeEntry[];
}

const DEFAULT_SYNC_INTERVAL_MS = 30_000;

/**
 * Periodically syncs SQLite state to the filesystem mirror.
 *
 * - SQLite → Filesystem: every ~30s (project.yaml, agents/roster.yaml)
 * - Filesystem → SQLite: on demand via reverseSync() (detects user edits)
 */
export class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;
  private syncing = false;

  constructor(
    private storage: StorageManager,
    private provider: SyncDataProvider,
    options?: { intervalMs?: number },
  ) {
    this.intervalMs = options?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  }

  /** Start the periodic sync loop. */
  startSync(intervalMs?: number): void {
    if (this.timer) return; // already running
    this.intervalMs = intervalMs ?? this.intervalMs;
    logger.debug({ module: 'storage', msg: 'SyncEngine started', intervalMs: this.intervalMs });

    // Run initial sync immediately
    this.syncNow();

    this.timer = setInterval(() => {
      try {
        this.syncNow();
      } catch (err) {
        logger.error({ module: 'storage', msg: 'Sync cycle failed', err: (err as Error).message });
      }
    }, this.intervalMs);
  }

  /** Stop the sync loop. */
  stopSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.debug({ module: 'storage', msg: 'SyncEngine stopped' });
    }
  }

  /** Whether the sync loop is running. */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Run a single sync cycle: SQLite → Filesystem for all active projects.
   * Returns the number of projects synced. Reentrant-safe — concurrent calls are no-ops.
   */
  syncNow(): number {
    if (this.syncing) return 0;
    this.syncing = true;
    try {
      const projectIds = this.provider.getActiveProjectIds();
      let synced = 0;

      for (const projectId of projectIds) {
        try {
          this.syncProject(projectId);
          synced++;
        } catch (err) {
          logger.warn({ module: 'storage', msg: 'Failed to sync project', projectId, err: (err as Error).message });
        }
      }

      return synced;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Sync a single project: write project.yaml, agents/roster.yaml, and knowledge markdown files.
   */
  private syncProject(projectId: string): void {
    const project = this.provider.getProject(projectId);
    if (!project) return;

    // Ensure directory structure
    this.storage.ensureProjectDirs(projectId);
    const projectDir = this.storage.getProjectDir(projectId);
    const manifest = this.storage.readSyncManifest(projectId);
    const newFiles: Record<string, string> = {};

    // 1. Write project.yaml
    const metadata: ProjectMetadata = {
      title: project.name,
      id: project.id,
      workingDir: project.cwd,
      storageMode: this.storage.getStorageMode(projectId),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const yamlContent = YAML.stringify(metadata, { lineWidth: 0 });
    this.syncFile(projectDir, 'project.yaml', yamlContent, manifest, newFiles);

    // 2. Write agents/roster.yaml
    const agents = this.provider.getAgentRoster(projectId);
    const rosterContent = YAML.stringify({ agents }, { lineWidth: 0 });
    this.syncFile(projectDir, 'agents/roster.yaml', rosterContent, manifest, newFiles);

    // 3. Write knowledge entries as markdown files
    if (this.provider.getKnowledge) {
      const entries = this.provider.getKnowledge(projectId);
      const seenPaths = new Set<string>();

      for (const entry of entries) {
        const relPath = `knowledge/${entry.category}/${entry.key}.md`;
        seenPaths.add(relPath);
        const mdContent = knowledgeToMarkdown(entry);
        this.syncFile(projectDir, relPath, mdContent, manifest, newFiles);
      }

      // Clean up orphaned knowledge files and carry forward non-knowledge hashes
      for (const [relPath, hash] of Object.entries(manifest.files)) {
        if (relPath.startsWith('knowledge/') && !seenPaths.has(relPath)) {
          // Knowledge entry was deleted from DB — remove the orphaned file
          const absPath = join(projectDir, relPath);
          try {
            if (existsSync(absPath)) unlinkSync(absPath);
          } catch { /* best-effort cleanup */ }
          continue;
        }
        if (!newFiles[relPath]) {
          newFiles[relPath] = hash;
        }
      }
    }

    // Update manifest
    const newManifest: SyncManifest = {
      lastSyncedAt: new Date().toISOString(),
      files: newFiles,
      schemaVersion: SYNC_SCHEMA_VERSION,
    };
    this.storage.writeSyncManifest(projectId, newManifest);
  }

  /** Write a file if its content hash has changed. */
  private syncFile(
    projectDir: string,
    relPath: string,
    content: string,
    manifest: SyncManifest,
    newFiles: Record<string, string>,
  ): void {
    const hash = contentHash(content);
    const existingHash = manifest.files[relPath];

    if (hash !== existingHash) {
      validatePathWithinDir(projectDir, relPath);
      atomicWriteFile(join(projectDir, relPath), content);
    }
    newFiles[relPath] = hash;
  }

  /**
   * Reverse sync: detect user edits to filesystem and report them.
   * Compares current file content hashes against the sync manifest.
   *
   * Returns a list of files that were modified by the user since last sync.
   * Callers are responsible for reading the files and applying changes to SQLite.
   */
  reverseSync(projectId: string): string[] {
    const projectDir = this.storage.getProjectDir(projectId);
    const manifest = this.storage.readSyncManifest(projectId);
    const modified: string[] = [];

    for (const [relPath, lastHash] of Object.entries(manifest.files)) {
      // Validate that the manifest path doesn't escape the project directory
      const absPath = validatePathWithinDir(projectDir, relPath);
      if (!existsSync(absPath)) {
        // File was deleted by user
        modified.push(relPath);
        continue;
      }
      try {
        const currentContent = readFileSync(absPath, 'utf-8');
        const currentHash = contentHash(currentContent);
        if (currentHash !== lastHash) {
          modified.push(relPath);
        }
      } catch {
        // Can't read — treat as modified
        modified.push(relPath);
      }
    }

    if (modified.length > 0) {
      logger.info({ module: 'storage', msg: 'Reverse sync detected user edits', projectId, modifiedFiles: modified });
    }

    return modified;
  }
}

/** SHA-256 content hash, truncated to 16 hex chars for compactness. */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Convert a knowledge entry to a human-readable markdown file. */
function knowledgeToMarkdown(entry: SyncKnowledgeEntry): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push(`category: ${entry.category}`);
  lines.push(`key: ${entry.key}`);
  if (entry.metadata) {
    const meta = entry.metadata;
    if (meta.source) lines.push(`source: ${meta.source}`);
    if (meta.confidence != null) lines.push(`confidence: ${meta.confidence}`);
    if (Array.isArray(meta.tags) && meta.tags.length > 0) {
      lines.push(`tags: [${meta.tags.join(', ')}]`);
    }
  }
  lines.push(`updatedAt: ${entry.updatedAt}`);
  lines.push(`---`);
  lines.push('');
  lines.push(entry.content);
  lines.push('');
  return lines.join('\n');
}
