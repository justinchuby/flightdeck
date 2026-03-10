/**
 * bundle-format tests.
 *
 * Covers: checksum computation, manifest creation, manifest validation,
 * bundle integrity verification, and format version.
 */
import { describe, it, expect } from 'vitest';
import {
  computeChecksum,
  createManifest,
  validateManifest,
  verifyChecksum,
  BUNDLE_FORMAT_VERSION,
} from './bundle-format.js';
import type { TeamBundle, KnowledgeCategory } from './bundle-format.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeContent(): Omit<import('./bundle-format.js').TeamBundle, 'manifest'> {
  return {
    agents: [
      { name: 'dev-1', role: 'developer', model: 'gpt-4', status: 'idle', config: {} },
    ],
    knowledge: {
      core: [{ key: 'arch', content: 'use monorepo', category: 'core' as KnowledgeCategory, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      procedural: [],
      semantic: [],
      episodic: [],
    },
    training: {
      corrections: [{ id: 'c1', agentId: 'dev-1', originalAction: 'wrong', correctedAction: 'right', tags: [], timestamp: '2026-01-01' }],
      feedback: [],
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('bundle-format', () => {
  describe('BUNDLE_FORMAT_VERSION', () => {
    it('is 1.0', () => {
      expect(BUNDLE_FORMAT_VERSION).toBe('1.0');
    });
  });

  describe('computeChecksum', () => {
    it('returns a 64-char hex string (SHA-256)', () => {
      const checksum = computeChecksum(makeContent());
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for same content', () => {
      const content = makeContent();
      expect(computeChecksum(content)).toBe(computeChecksum(content));
    });

    it('changes when content changes', () => {
      const a = makeContent();
      const b = makeContent();
      b.agents.push({ name: 'dev-2', role: 'architect', model: 'gpt-4', status: 'idle', config: {} });
      expect(computeChecksum(a)).not.toBe(computeChecksum(b));
    });
  });

  describe('createManifest', () => {
    it('creates manifest with correct stats', () => {
      const content = makeContent();
      const manifest = createManifest(content, { projectId: 'proj-1', teamId: 'team-1' });

      expect(manifest.bundleFormat).toBe('1.0');
      expect(manifest.exportedAt).toBeTruthy();
      expect(manifest.sourceProjectId).toBe('proj-1');
      expect(manifest.sourceTeamId).toBe('team-1');
      expect(manifest.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.stats.agentCount).toBe(1);
      expect(manifest.stats.knowledgeCount).toBe(1);
      expect(manifest.stats.correctionCount).toBe(1);
      expect(manifest.stats.feedbackCount).toBe(0);
    });

    it('works without projectId/teamId', () => {
      const manifest = createManifest(makeContent());
      expect(manifest.sourceProjectId).toBeUndefined();
      expect(manifest.sourceTeamId).toBeUndefined();
    });

    it('counts knowledge across all categories', () => {
      const content = makeContent();
      content.knowledge.procedural = [
        { key: 'proc1', content: 'step 1', category: 'procedural' as KnowledgeCategory, createdAt: '', updatedAt: '' },
        { key: 'proc2', content: 'step 2', category: 'procedural' as KnowledgeCategory, createdAt: '', updatedAt: '' },
      ];
      const manifest = createManifest(content);
      expect(manifest.stats.knowledgeCount).toBe(3); // 1 core + 2 procedural
    });
  });

  describe('validateManifest', () => {
    it('validates a correct manifest', () => {
      const manifest = createManifest(makeContent());
      expect(validateManifest(manifest)).toBe(true);
    });

    it('rejects null/undefined', () => {
      expect(validateManifest(null)).toBe(false);
      expect(validateManifest(undefined)).toBe(false);
    });

    it('rejects wrong format version', () => {
      const manifest = createManifest(makeContent());
      (manifest as any).bundleFormat = '2.0';
      expect(validateManifest(manifest)).toBe(false);
    });

    it('rejects missing checksum', () => {
      const manifest = createManifest(makeContent());
      (manifest as any).checksum = '';
      expect(validateManifest(manifest)).toBe(false);
    });

    it('rejects missing stats', () => {
      const manifest = createManifest(makeContent());
      (manifest as any).stats = null;
      expect(validateManifest(manifest)).toBe(false);
    });

    it('rejects non-object', () => {
      expect(validateManifest('string')).toBe(false);
      expect(validateManifest(42)).toBe(false);
    });
  });

  describe('verifyChecksum', () => {
    it('returns true for valid bundle', () => {
      const content = makeContent();
      const manifest = createManifest(content);
      const bundle: TeamBundle = { manifest, ...content };
      expect(verifyChecksum(bundle)).toBe(true);
    });

    it('returns false when content is tampered', () => {
      const content = makeContent();
      const manifest = createManifest(content);
      const bundle: TeamBundle = { manifest, ...content };

      // Tamper with agents
      bundle.agents.push({ name: 'hacker', role: 'evil', model: 'x', status: 'idle', config: {} });
      expect(verifyChecksum(bundle)).toBe(false);
    });

    it('returns false when checksum is wrong', () => {
      const content = makeContent();
      const manifest = createManifest(content);
      manifest.checksum = 'a'.repeat(64);
      const bundle: TeamBundle = { manifest, ...content };
      expect(verifyChecksum(bundle)).toBe(false);
    });
  });
});
