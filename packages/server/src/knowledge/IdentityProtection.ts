/**
 * IdentityProtection — hash-based integrity verification for core knowledge.
 *
 * Core knowledge entries (agent identity, project rules, user preferences)
 * are protected with SHA-256 content hashes stored in entry metadata.
 * On startup or on demand, integrity can be verified by recomputing
 * hashes and comparing against stored values.
 *
 * This is a deeper layer of protection beyond MemoryCategoryManager's
 * soft read-only enforcement — it detects external tampering (e.g.,
 * direct DB edits or filesystem sync corruption).
 */
import { createHash } from 'crypto';
import { KnowledgeStore } from './KnowledgeStore.js';
import type { KnowledgeEntry, KnowledgeMetadata } from './types.js';

// ── Constants ───────────────────────────────────────────────────────

/** Metadata key for the SHA-256 content hash. */
const HASH_KEY = '_protectedHash';

/** Metadata key for the protection timestamp. */
const PROTECTED_AT_KEY = '_protectedAt';

/** Hash algorithm used for integrity verification. */
const HASH_ALGORITHM = 'sha256';

// ── Types ───────────────────────────────────────────────────────────

export interface IntegrityResult {
  projectId: string;
  totalChecked: number;
  passed: number;
  failed: number;
  failures: IntegrityFailure[];
}

export interface IntegrityFailure {
  key: string;
  reason: 'hash_mismatch' | 'missing_hash' | 'missing_entry';
  expectedHash?: string;
  actualHash?: string;
}

export interface ProtectedEntry {
  key: string;
  contentHash: string;
  protectedAt: string;
}

// ── IdentityProtection ──────────────────────────────────────────────

export class IdentityProtection {
  constructor(private store: KnowledgeStore) {}

  /**
   * Protect all current core knowledge entries for a project.
   * Computes SHA-256 hashes and stores them in entry metadata.
   * Returns the list of newly protected entries.
   */
  protectCoreFiles(projectId: string): ProtectedEntry[] {
    const entries = this.store.getByCategory(projectId, 'core');
    const protected_: ProtectedEntry[] = [];

    for (const entry of entries) {
      const hash = computeHash(entry.content);
      const protectedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

      // Merge protection fields into existing metadata
      const existingMeta = entry.metadata ?? {};
      const updatedMeta: KnowledgeMetadata = {
        ...existingMeta,
        [HASH_KEY]: hash,
        [PROTECTED_AT_KEY]: protectedAt,
      };

      // Update the entry's metadata (re-put with same content preserves updatedAt via upsert)
      this.store.put(projectId, 'core', entry.key, entry.content, updatedMeta);

      protected_.push({
        key: entry.key,
        contentHash: hash,
        protectedAt,
      });
    }

    return protected_;
  }

  /**
   * Protect a single core knowledge entry.
   * @throws Error if the entry doesn't exist or isn't in the core category.
   */
  protectEntry(projectId: string, key: string): ProtectedEntry {
    const entry = this.store.get(projectId, 'core', key);
    if (!entry) {
      throw new Error(`Core entry "${key}" not found in project "${projectId}".`);
    }

    const hash = computeHash(entry.content);
    const protectedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const updatedMeta: KnowledgeMetadata = {
      ...(entry.metadata ?? {}),
      [HASH_KEY]: hash,
      [PROTECTED_AT_KEY]: protectedAt,
    };

    this.store.put(projectId, 'core', key, entry.content, updatedMeta);

    return { key, contentHash: hash, protectedAt };
  }

  /**
   * Verify integrity of all protected core entries for a project.
   * Recomputes content hashes and compares against stored values.
   */
  verifyIntegrity(projectId: string): IntegrityResult {
    const entries = this.store.getByCategory(projectId, 'core');
    const failures: IntegrityFailure[] = [];
    let totalChecked = 0;

    for (const entry of entries) {
      const storedHash = getStoredHash(entry);
      if (!storedHash) {
        // Entry exists but was never protected — skip (not a failure)
        continue;
      }

      totalChecked++;
      const actualHash = computeHash(entry.content);

      if (actualHash !== storedHash) {
        failures.push({
          key: entry.key,
          reason: 'hash_mismatch',
          expectedHash: storedHash,
          actualHash,
        });
      }
    }

    return {
      projectId,
      totalChecked,
      passed: totalChecked - failures.length,
      failed: failures.length,
      failures,
    };
  }

  /**
   * Verify integrity of a single entry by key.
   * Returns null if the entry passes or has no hash, or an IntegrityFailure if it fails.
   */
  verifyEntry(projectId: string, key: string): IntegrityFailure | null {
    const entry = this.store.get(projectId, 'core', key);
    if (!entry) {
      return { key, reason: 'missing_entry' };
    }

    const storedHash = getStoredHash(entry);
    if (!storedHash) {
      return null; // Not protected — nothing to verify
    }

    const actualHash = computeHash(entry.content);
    if (actualHash !== storedHash) {
      return {
        key,
        reason: 'hash_mismatch',
        expectedHash: storedHash,
        actualHash,
      };
    }

    return null;
  }

  /**
   * Check if a specific knowledge entry is protected (has a stored hash).
   */
  isProtected(projectId: string, category: string, key: string): boolean {
    if (category !== 'core') return false;

    const entry = this.store.get(projectId, 'core', key);
    if (!entry) return false;

    return getStoredHash(entry) !== null;
  }

  /**
   * Get all protected entries for a project.
   */
  getProtectedEntries(projectId: string): ProtectedEntry[] {
    const entries = this.store.getByCategory(projectId, 'core');
    const result: ProtectedEntry[] = [];

    for (const entry of entries) {
      const hash = getStoredHash(entry);
      const protectedAt = getProtectedAt(entry);
      if (hash && protectedAt) {
        result.push({ key: entry.key, contentHash: hash, protectedAt });
      }
    }

    return result;
  }

  /**
   * Remove protection from a core entry (e.g., before an authorized update).
   * Returns true if protection was removed, false if entry wasn't protected.
   */
  unprotectEntry(projectId: string, key: string): boolean {
    const entry = this.store.get(projectId, 'core', key);
    if (!entry) return false;

    const storedHash = getStoredHash(entry);
    if (!storedHash) return false;

    // Remove protection metadata fields
    const meta = { ...(entry.metadata ?? {}) };
    delete meta[HASH_KEY];
    delete meta[PROTECTED_AT_KEY];

    this.store.put(projectId, 'core', key, entry.content, meta);
    return true;
  }

  /**
   * Reprotect an entry after an authorized content change.
   * Computes a new hash for the current content.
   * @throws Error if entry doesn't exist.
   */
  reprotectEntry(projectId: string, key: string): ProtectedEntry {
    return this.protectEntry(projectId, key);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Compute SHA-256 hash of content. */
function computeHash(content: string): string {
  return createHash(HASH_ALGORITHM).update(content, 'utf-8').digest('hex');
}

/** Extract stored hash from entry metadata, or null if not protected. */
function getStoredHash(entry: KnowledgeEntry): string | null {
  const hash = entry.metadata?.[HASH_KEY];
  return typeof hash === 'string' ? hash : null;
}

/** Extract protection timestamp from entry metadata. */
function getProtectedAt(entry: KnowledgeEntry): string | null {
  const ts = entry.metadata?.[PROTECTED_AT_KEY];
  return typeof ts === 'string' ? ts : null;
}

/** Exported for testing — compute a SHA-256 hash. */
export function hashContent(content: string): string {
  return computeHash(content);
}
