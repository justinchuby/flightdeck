/** Storage mode for a project's filesystem mirror. */
export type StorageMode = 'user' | 'local';

/** Metadata stored in project.yaml */
export interface ProjectMetadata {
  title: string;
  id: string;
  workingDir: string | null;
  storageMode: StorageMode;
  createdAt: string;
  updatedAt: string;
}

/** Manifest tracking the last sync state for deletion detection. */
export interface SyncManifest {
  /** ISO timestamp of last sync */
  lastSyncedAt: string;
  /** Map of relative file paths → content hash at last sync */
  files: Record<string, string>;
  /** Schema version for forward compat */
  schemaVersion: number;
}

/** Subdirectories created for every project. */
export const PROJECT_SUBDIRS = [
  'knowledge',
  'memory',
  'sessions',
  'agents',
  'logs',
] as const;

/** Current schema version for sync manifests */
export const SYNC_SCHEMA_VERSION = 1;
