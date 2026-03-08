import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { IdentityProtection, hashContent } from '../IdentityProtection.js';

describe('IdentityProtection', () => {
  let db: Database;
  let store: KnowledgeStore;
  let protection: IdentityProtection;
  const projectId = 'test-project-identity';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    protection = new IdentityProtection(store);
  });

  afterEach(() => {
    db.close();
  });

  // ── protectCoreFiles ──────────────────────────────────────────

  describe('protectCoreFiles', () => {
    it('protects all core entries and returns protected list', () => {
      store.put(projectId, 'core', 'identity', 'I am the architect');
      store.put(projectId, 'core', 'preferences', 'Use explicit types');

      const result = protection.protectCoreFiles(projectId);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('identity');
      expect(result[0].contentHash).toBe(hashContent('I am the architect'));
      expect(result[0].protectedAt).toBeDefined();
      expect(result[1].key).toBe('preferences');
    });

    it('stores hash in entry metadata', () => {
      store.put(projectId, 'core', 'rules', 'No any types');
      protection.protectCoreFiles(projectId);

      const entry = store.get(projectId, 'core', 'rules');
      expect(entry?.metadata?._protectedHash).toBe(hashContent('No any types'));
      expect(entry?.metadata?._protectedAt).toBeDefined();
    });

    it('preserves existing metadata when adding protection', () => {
      store.put(projectId, 'core', 'identity', 'architect', {
        source: 'user',
        confidence: 1.0,
        tags: ['identity'],
      });

      protection.protectCoreFiles(projectId);

      const entry = store.get(projectId, 'core', 'identity');
      expect(entry?.metadata?.source).toBe('user');
      expect(entry?.metadata?.confidence).toBe(1.0);
      expect(entry?.metadata?.tags).toEqual(['identity']);
      expect(entry?.metadata?._protectedHash).toBeDefined();
    });

    it('returns empty array when no core entries exist', () => {
      const result = protection.protectCoreFiles(projectId);
      expect(result).toHaveLength(0);
    });

    it('re-protects entries with updated hashes', () => {
      store.put(projectId, 'core', 'rules', 'Rule v1');
      protection.protectCoreFiles(projectId);

      // Tamper directly via store
      store.put(projectId, 'core', 'rules', 'Rule v2', {
        _protectedHash: hashContent('Rule v1'),
      });

      // Re-protect should update hash to match new content
      const result = protection.protectCoreFiles(projectId);
      expect(result[0].contentHash).toBe(hashContent('Rule v2'));
    });
  });

  // ── protectEntry ──────────────────────────────────────────────

  describe('protectEntry', () => {
    it('protects a single entry', () => {
      store.put(projectId, 'core', 'identity', 'I am the developer');
      const result = protection.protectEntry(projectId, 'identity');

      expect(result.key).toBe('identity');
      expect(result.contentHash).toBe(hashContent('I am the developer'));
    });

    it('throws for non-existent entry', () => {
      expect(() => protection.protectEntry(projectId, 'nonexistent')).toThrow(
        /Core entry "nonexistent" not found/,
      );
    });
  });

  // ── verifyIntegrity ───────────────────────────────────────────

  describe('verifyIntegrity', () => {
    it('passes when content is unchanged', () => {
      store.put(projectId, 'core', 'identity', 'I am the architect');
      store.put(projectId, 'core', 'rules', 'No any types');
      protection.protectCoreFiles(projectId);

      const result = protection.verifyIntegrity(projectId);

      expect(result.totalChecked).toBe(2);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.failures).toHaveLength(0);
    });

    it('detects content tampering', () => {
      store.put(projectId, 'core', 'identity', 'I am the architect');
      protection.protectCoreFiles(projectId);

      // Tamper: change content but keep the old hash
      const entry = store.get(projectId, 'core', 'identity')!;
      db.run(
        `UPDATE knowledge SET content = ? WHERE id = ?`,
        ['I am the hacker', entry.id],
      );

      const result = protection.verifyIntegrity(projectId);

      expect(result.failed).toBe(1);
      expect(result.failures[0].key).toBe('identity');
      expect(result.failures[0].reason).toBe('hash_mismatch');
      expect(result.failures[0].expectedHash).toBe(hashContent('I am the architect'));
      expect(result.failures[0].actualHash).toBe(hashContent('I am the hacker'));
    });

    it('skips unprotected entries', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      store.put(projectId, 'core', 'unprotected', 'no hash');

      // Only protect one entry
      protection.protectEntry(projectId, 'identity');

      const result = protection.verifyIntegrity(projectId);
      expect(result.totalChecked).toBe(1);
      expect(result.passed).toBe(1);
    });

    it('returns clean result for empty project', () => {
      const result = protection.verifyIntegrity(projectId);
      expect(result.totalChecked).toBe(0);
      expect(result.passed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('detects multiple tampered entries', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      store.put(projectId, 'core', 'rules', 'strict');
      store.put(projectId, 'core', 'prefs', 'typescript');
      protection.protectCoreFiles(projectId);

      // Tamper two entries
      const id1 = store.get(projectId, 'core', 'identity')!.id;
      const id2 = store.get(projectId, 'core', 'rules')!.id;
      db.run(`UPDATE knowledge SET content = ? WHERE id = ?`, ['hacked', id1]);
      db.run(`UPDATE knowledge SET content = ? WHERE id = ?`, ['hacked', id2]);

      const result = protection.verifyIntegrity(projectId);
      expect(result.failed).toBe(2);
      expect(result.passed).toBe(1);
      expect(result.failures.map((f) => f.key).sort()).toEqual(['identity', 'rules']);
    });
  });

  // ── verifyEntry ───────────────────────────────────────────────

  describe('verifyEntry', () => {
    it('returns null for valid protected entry', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      protection.protectEntry(projectId, 'identity');

      expect(protection.verifyEntry(projectId, 'identity')).toBeNull();
    });

    it('returns failure for tampered entry', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      protection.protectEntry(projectId, 'identity');

      const id = store.get(projectId, 'core', 'identity')!.id;
      db.run(`UPDATE knowledge SET content = ? WHERE id = ?`, ['hacked', id]);

      const failure = protection.verifyEntry(projectId, 'identity');
      expect(failure).not.toBeNull();
      expect(failure!.reason).toBe('hash_mismatch');
    });

    it('returns null for unprotected entry', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      expect(protection.verifyEntry(projectId, 'identity')).toBeNull();
    });

    it('returns missing_entry for non-existent key', () => {
      const failure = protection.verifyEntry(projectId, 'nonexistent');
      expect(failure).not.toBeNull();
      expect(failure!.reason).toBe('missing_entry');
    });
  });

  // ── isProtected ───────────────────────────────────────────────

  describe('isProtected', () => {
    it('returns true for protected core entry', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      protection.protectEntry(projectId, 'identity');

      expect(protection.isProtected(projectId, 'core', 'identity')).toBe(true);
    });

    it('returns false for unprotected core entry', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      expect(protection.isProtected(projectId, 'core', 'identity')).toBe(false);
    });

    it('returns false for non-core categories', () => {
      store.put(projectId, 'semantic', 'fact', 'something');
      expect(protection.isProtected(projectId, 'semantic', 'fact')).toBe(false);
    });

    it('returns false for non-existent entry', () => {
      expect(protection.isProtected(projectId, 'core', 'nonexistent')).toBe(false);
    });
  });

  // ── getProtectedEntries ───────────────────────────────────────

  describe('getProtectedEntries', () => {
    it('returns only protected entries', () => {
      store.put(projectId, 'core', 'protected-1', 'content 1');
      store.put(projectId, 'core', 'protected-2', 'content 2');
      store.put(projectId, 'core', 'unprotected', 'content 3');

      protection.protectEntry(projectId, 'protected-1');
      protection.protectEntry(projectId, 'protected-2');

      const result = protection.getProtectedEntries(projectId);
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.key).sort()).toEqual(['protected-1', 'protected-2']);
    });

    it('returns empty array when no entries are protected', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      expect(protection.getProtectedEntries(projectId)).toHaveLength(0);
    });

    it('includes contentHash and protectedAt', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      protection.protectEntry(projectId, 'identity');

      const entries = protection.getProtectedEntries(projectId);
      expect(entries[0].contentHash).toBe(hashContent('agent'));
      expect(entries[0].protectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── unprotectEntry ────────────────────────────────────────────

  describe('unprotectEntry', () => {
    it('removes protection metadata', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      protection.protectEntry(projectId, 'identity');

      expect(protection.unprotectEntry(projectId, 'identity')).toBe(true);
      expect(protection.isProtected(projectId, 'core', 'identity')).toBe(false);
    });

    it('preserves other metadata when removing protection', () => {
      store.put(projectId, 'core', 'identity', 'agent', {
        source: 'user',
        tags: ['identity'],
      });
      protection.protectEntry(projectId, 'identity');
      protection.unprotectEntry(projectId, 'identity');

      const entry = store.get(projectId, 'core', 'identity');
      expect(entry?.metadata?.source).toBe('user');
      expect(entry?.metadata?.tags).toEqual(['identity']);
      expect(entry?.metadata?._protectedHash).toBeUndefined();
      expect(entry?.metadata?._protectedAt).toBeUndefined();
    });

    it('returns false for non-existent entry', () => {
      expect(protection.unprotectEntry(projectId, 'nonexistent')).toBe(false);
    });

    it('returns false for unprotected entry', () => {
      store.put(projectId, 'core', 'identity', 'agent');
      expect(protection.unprotectEntry(projectId, 'identity')).toBe(false);
    });
  });

  // ── reprotectEntry ────────────────────────────────────────────

  describe('reprotectEntry', () => {
    it('updates hash after authorized content change', () => {
      store.put(projectId, 'core', 'identity', 'v1');
      protection.protectEntry(projectId, 'identity');

      // Simulate authorized update: unprotect, update content, reprotect
      protection.unprotectEntry(projectId, 'identity');
      store.put(projectId, 'core', 'identity', 'v2');
      const result = protection.reprotectEntry(projectId, 'identity');

      expect(result.contentHash).toBe(hashContent('v2'));

      // Integrity should pass
      const integrity = protection.verifyIntegrity(projectId);
      expect(integrity.failed).toBe(0);
    });
  });

  // ── hashContent utility ───────────────────────────────────────

  describe('hashContent', () => {
    it('produces consistent SHA-256 hashes', () => {
      const hash1 = hashContent('hello world');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const hash1 = hashContent('hello');
      const hash2 = hashContent('world');
      expect(hash1).not.toBe(hash2);
    });

    it('produces 64-character hex strings', () => {
      const hash = hashContent('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── Project Isolation ─────────────────────────────────────────

  describe('project isolation', () => {
    it('protection is project-scoped', () => {
      store.put('project-a', 'core', 'identity', 'Agent A');
      store.put('project-b', 'core', 'identity', 'Agent B');

      protection.protectCoreFiles('project-a');

      expect(protection.isProtected('project-a', 'core', 'identity')).toBe(true);
      expect(protection.isProtected('project-b', 'core', 'identity')).toBe(false);
    });

    it('integrity verification is project-scoped', () => {
      store.put('project-a', 'core', 'identity', 'Agent A');
      store.put('project-b', 'core', 'identity', 'Agent B');
      protection.protectCoreFiles('project-a');
      protection.protectCoreFiles('project-b');

      // Tamper project-a
      const id = store.get('project-a', 'core', 'identity')!.id;
      db.run(`UPDATE knowledge SET content = ? WHERE id = ?`, ['hacked', id]);

      const resultA = protection.verifyIntegrity('project-a');
      const resultB = protection.verifyIntegrity('project-b');

      expect(resultA.failed).toBe(1);
      expect(resultB.failed).toBe(0);
    });
  });

  // ── End-to-end: protect → tamper → detect ─────────────────────

  describe('end-to-end tamper detection', () => {
    it('full workflow: setup → protect → tamper → detect → remediate', () => {
      // 1. Setup core knowledge
      store.put(projectId, 'core', 'identity', 'I am a secure agent');
      store.put(projectId, 'core', 'rules', 'Follow strict typing');

      // 2. Protect
      const protected_ = protection.protectCoreFiles(projectId);
      expect(protected_).toHaveLength(2);

      // 3. Verify passes initially
      let integrity = protection.verifyIntegrity(projectId);
      expect(integrity.failed).toBe(0);

      // 4. Simulate external tampering (direct DB edit)
      const id = store.get(projectId, 'core', 'identity')!.id;
      db.run(`UPDATE knowledge SET content = ? WHERE id = ?`, ['I am a compromised agent', id]);

      // 5. Detect tampering
      integrity = protection.verifyIntegrity(projectId);
      expect(integrity.failed).toBe(1);
      expect(integrity.failures[0].key).toBe('identity');
      expect(integrity.failures[0].reason).toBe('hash_mismatch');

      // 6. Remediate: restore and reprotect
      store.put(projectId, 'core', 'identity', 'I am a secure agent', {
        _protectedHash: hashContent('I am a secure agent'),
        _protectedAt: new Date().toISOString(),
      });
      protection.reprotectEntry(projectId, 'identity');

      // 7. Verify passes again
      integrity = protection.verifyIntegrity(projectId);
      expect(integrity.failed).toBe(0);
    });
  });
});
