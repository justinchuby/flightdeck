/**
 * ImportValidator tests — 5-phase validation for team bundles.
 */
import { describe, it, expect } from 'vitest';
import { ImportValidator } from './ImportValidator.js';
import type { ConflictCheckDeps } from './ImportValidator.js';
import { computeChecksum, createManifest, BUNDLE_FORMAT_VERSION } from './bundle-format.js';
import type { TeamBundle, KnowledgeCategory } from './bundle-format.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeBundle(overrides?: Partial<TeamBundle>): TeamBundle {
  const base = {
    agents: [
      { name: 'dev-alpha', role: 'developer', model: 'fast', status: 'idle', config: {} },
    ],
    knowledge: {
      core: [{ key: 'project-rules', content: 'Be nice', category: 'core' as const, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
      episodic: [],
      procedural: [],
      semantic: [],
    },
    training: {
      corrections: [],
      feedback: [],
    },
  };

  const merged = { ...base, ...overrides };
  if (overrides?.agents) merged.agents = overrides.agents;
  if (overrides?.knowledge) merged.knowledge = { ...base.knowledge, ...overrides.knowledge };
  if (overrides?.training) merged.training = { ...base.training, ...overrides.training };

  const manifest = overrides?.manifest ?? createManifest(merged);
  return { manifest, ...merged };
}

function noConflicts(): ConflictCheckDeps {
  return {
    agentNameExists: () => false,
    knowledgeKeyExists: () => false,
  };
}

function withAgentConflict(name: string): ConflictCheckDeps {
  return {
    agentNameExists: (n) => n === name,
    knowledgeKeyExists: () => false,
  };
}

function withKnowledgeConflict(category: KnowledgeCategory, key: string): ConflictCheckDeps {
  return {
    agentNameExists: () => false,
    knowledgeKeyExists: (c, k) => c === category && k === key,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ImportValidator', () => {
  const validator = new ImportValidator();

  describe('Phase 1: Format check', () => {
    it('accepts a valid bundle', () => {
      const result = validator.validate(makeBundle());
      expect(result.valid).toBe(true);
      expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    });

    it('rejects null input', () => {
      const result = validator.validate(null);
      expect(result.valid).toBe(false);
      expect(result.issues[0].phase).toBe('format');
      expect(result.issues[0].message).toContain('non-null object');
    });

    it('rejects missing manifest', () => {
      const result = validator.validate({ agents: [], knowledge: {}, training: {} });
      expect(result.valid).toBe(false);
      expect(result.issues[0].field).toBe('manifest');
    });

    it('rejects invalid manifest structure', () => {
      const result = validator.validate({
        manifest: { bundleFormat: '1.0', exportedAt: 'x' }, // Missing checksum, stats
        agents: [],
        knowledge: {},
        training: { corrections: [], feedback: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.message.includes('Invalid manifest'))).toBe(true);
    });

    it('rejects missing agents array', () => {
      const bundle = makeBundle();
      (bundle as any).agents = 'not an array';
      // Need to re-set manifest checksum
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'agents')).toBe(true);
    });

    it('rejects agent without name', () => {
      const bundle = makeBundle({
        agents: [{ name: '', role: 'dev', model: 'fast', status: 'idle', config: {} }] as any,
      });
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'agents[0].name')).toBe(true);
    });

    it('rejects agent without role', () => {
      const bundle = makeBundle({
        agents: [{ name: 'test', role: '', model: 'fast', status: 'idle', config: {} }] as any,
      });
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'agents[0].role')).toBe(true);
    });

    it('rejects knowledge with non-array category', () => {
      const bundle = makeBundle();
      (bundle.knowledge as any).core = 'not an array';
      bundle.manifest = createManifest(bundle);
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'knowledge.core')).toBe(true);
    });

    it('rejects knowledge entry without key', () => {
      const bundle = makeBundle({
        knowledge: {
          core: [{ key: '', content: 'test', category: 'core', createdAt: '', updatedAt: '' }],
          episodic: [], procedural: [], semantic: [],
        } as any,
      });
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field?.includes('core[0].key'))).toBe(true);
    });

    it('rejects missing training object', () => {
      const bundle = makeBundle();
      (bundle as any).training = null;
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'training')).toBe(true);
    });
  });

  describe('Phase 2: Version check', () => {
    it('accepts current bundle format version', () => {
      const result = validator.validate(makeBundle());
      expect(result.issues.filter(i => i.phase === 'version')).toHaveLength(0);
    });

    it('rejects unsupported version', () => {
      const bundle = makeBundle();
      bundle.manifest.bundleFormat = '99.0';
      // This also fails manifest validation since validateManifest checks version
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
    });
  });

  describe('Phase 3: Integrity check', () => {
    it('passes with valid checksum', () => {
      const result = validator.validate(makeBundle());
      expect(result.issues.filter(i => i.phase === 'integrity')).toHaveLength(0);
    });

    it('fails with tampered content', () => {
      const bundle = makeBundle();
      // Tamper with content after checksum was computed
      bundle.agents[0].name = 'tampered-agent';
      const result = validator.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.phase === 'integrity')).toBe(true);
    });
  });

  describe('Phase 4: Size limits', () => {
    it('accepts normal-sized bundle', () => {
      const result = validator.validate(makeBundle());
      expect(result.issues.filter(i => i.phase === 'size')).toHaveLength(0);
    });

    it('warns about too many agents', () => {
      const agents = Array.from({ length: 101 }, (_, i) => ({
        name: `agent-${i}`, role: 'dev', model: 'fast', status: 'idle', config: {},
      }));
      const bundle = makeBundle({ agents } as any);
      const result = validator.validate(bundle);
      expect(result.issues.some(i => i.phase === 'size' && i.severity === 'warning' && i.message.includes('agents'))).toBe(true);
    });
  });

  describe('Phase 5: Conflict detection', () => {
    it('detects agent name conflicts', () => {
      const bundle = makeBundle();
      const deps = withAgentConflict('dev-alpha');
      const result = validator.validate(bundle, deps);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe('agent');
      expect(result.conflicts[0].key).toBe('dev-alpha');
    });

    it('detects knowledge key conflicts', () => {
      const bundle = makeBundle();
      const deps = withKnowledgeConflict('core', 'project-rules');
      const result = validator.validate(bundle, deps);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe('knowledge');
      expect(result.conflicts[0].key).toBe('core:project-rules');
    });

    it('reports no conflicts when none exist', () => {
      const result = validator.validate(makeBundle(), noConflicts());
      expect(result.conflicts).toHaveLength(0);
    });

    it('skips conflict detection without deps', () => {
      const result = validator.validate(makeBundle());
      expect(result.conflicts).toHaveLength(0); // No deps → no conflict check
    });
  });

  describe('Dry-run summary', () => {
    it('includes dry-run summary for valid bundle', () => {
      const result = validator.validate(makeBundle(), noConflicts());
      expect(result.dryRun).toBeDefined();
      expect(result.dryRun!.agentsToCreate).toBe(1);
      expect(result.dryRun!.knowledgeToImport).toBe(1);
    });

    it('reflects conflicts in dry-run counts', () => {
      const bundle = makeBundle();
      const deps = withAgentConflict('dev-alpha');
      const result = validator.validate(bundle, deps);
      expect(result.dryRun!.agentsToCreate).toBe(0);
      expect(result.dryRun!.agentsToRename).toBe(1);
    });
  });
});
