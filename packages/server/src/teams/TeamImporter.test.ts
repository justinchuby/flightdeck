/**
 * TeamImporter tests — import with conflict resolution & validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamImporter } from './TeamImporter.js';
import type { ImportOptions, TeamImporterDeps } from './TeamImporter.js';
import { createManifest } from './bundle-format.js';
import type { TeamBundle, KnowledgeCategory } from './bundle-format.js';

// ── Mock Deps ───────────────────────────────────────────────────────

function createMockRoster() {
  const agents: Array<{
    agentId: string; role: string; model: string; status: string;
    projectId?: string; teamId?: string; metadata?: Record<string, unknown>;
  }> = [];

  return {
    upsertAgent: vi.fn((agentId: string, role: string, model: string, status: string, sessionId?: string, projectId?: string, metadata?: Record<string, unknown>, teamId?: string) => {
      agents.push({ agentId, role, model, status, projectId, teamId, metadata });
      return { agentId, role, model, status, projectId, teamId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }),
    getAgent: vi.fn(),
    getAllAgents: vi.fn((_status?: string, _teamId?: string) => {
      return agents.filter(a => !_teamId || a.teamId === _teamId);
    }),
    _agents: agents,
  };
}

function createMockKnowledge() {
  const entries = new Map<string, { projectId: string; category: string; key: string; content: string; metadata?: unknown }>();

  return {
    put: vi.fn((projectId: string, category: string, key: string, content: string, metadata?: unknown) => {
      const id = `${projectId}:${category}:${key}`;
      entries.set(id, { projectId, category, key, content, metadata });
      return { id: 1, projectId, category, key, content, metadata, createdAt: '', updatedAt: '' };
    }),
    get: vi.fn((projectId: string, category: string, key: string) => {
      const id = `${projectId}:${category}:${key}`;
      return entries.get(id);
    }),
    _entries: entries,
  };
}

function createMockTraining() {
  return {
    captureCorrection: vi.fn(),
    captureFeedback: vi.fn(),
  };
}

function createDeps() {
  const roster = createMockRoster();
  const knowledge = createMockKnowledge();
  const training = createMockTraining();
  return {
    agentRoster: roster,
    knowledgeStore: knowledge,
    trainingCapture: training,
    // Keep shortcuts for test assertions
    _roster: roster,
    _knowledge: knowledge,
    _training: training,
  };
}

// ── Bundle Factory ──────────────────────────────────────────────────

function makeBundle(overrides?: {
  agents?: any[];
  knowledge?: Record<string, any[]>;
  corrections?: any[];
  feedback?: any[];
}): TeamBundle {
  const agents = overrides?.agents ?? [
    { name: 'dev-alpha', role: 'developer', model: 'fast', status: 'idle', config: { autopilot: true } },
    { name: 'arch-beta', role: 'architect', model: 'standard', status: 'idle', config: {} },
  ];

  const knowledge = {
    core: overrides?.knowledge?.core ?? [
      { key: 'project-rules', content: 'Follow TDD', category: 'core', confidence: 0.9, tags: ['rules'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ],
    episodic: overrides?.knowledge?.episodic ?? [],
    procedural: overrides?.knowledge?.procedural ?? [
      { key: 'git-workflow', content: 'Always rebase', category: 'procedural', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ],
    semantic: overrides?.knowledge?.semantic ?? [],
  };

  const training = {
    corrections: overrides?.corrections ?? [
      { id: 'c1', agentId: 'dev-alpha', originalAction: 'used merge', correctedAction: 'use rebase', tags: ['git'], timestamp: '2026-01-01T00:00:00Z' },
    ],
    feedback: overrides?.feedback ?? [
      { id: 'f1', agentId: 'arch-beta', action: 'good API design', rating: 'positive' as const, tags: ['design'], timestamp: '2026-01-01T00:00:00Z' },
    ],
  };

  const content = { agents, knowledge, training };
  const manifest = createManifest(content, { projectId: 'source-proj', teamId: 'source-team' });
  return { manifest, ...content };
}

const DEFAULT_OPTIONS: ImportOptions = {
  projectId: 'target-proj',
  teamId: 'target-team',
};

// ── Tests ───────────────────────────────────────────────────────────

describe('TeamImporter', () => {
  let deps: ReturnType<typeof createDeps>;
  let importer: TeamImporter;

  beforeEach(() => {
    deps = createDeps();
    importer = new TeamImporter(deps as unknown as TeamImporterDeps);
  });

  describe('successful import', () => {
    it('imports agents, knowledge, and training', () => {
      const bundle = makeBundle();
      const report = importer.import(bundle, DEFAULT_OPTIONS);

      expect(report.success).toBe(true);
      expect(report.teamId).toBe('target-team');
      expect(report.agents).toHaveLength(2);
      expect(report.agents[0].action).toBe('created');
      expect(report.agents[1].action).toBe('created');
      expect(report.knowledge.imported).toBe(2);
      expect(report.training.correctionsImported).toBe(1);
      expect(report.training.feedbackImported).toBe(1);
    });

    it('creates roster entries for each agent', () => {
      const bundle = makeBundle();
      importer.import(bundle, DEFAULT_OPTIONS);

      expect(deps._roster.upsertAgent).toHaveBeenCalledTimes(2);
      // Check first agent
      const firstCall = deps._roster.upsertAgent.mock.calls[0];
      expect(firstCall[1]).toBe('dev-alpha'); // role (used as name)
      expect(firstCall[2]).toBe('fast'); // model
      expect(firstCall[5]).toBe('target-proj'); // projectId
      expect(firstCall[7]).toBe('target-team'); // teamId
    });

    it('stores imported metadata on agents', () => {
      const bundle = makeBundle();
      importer.import(bundle, DEFAULT_OPTIONS);

      const metadata = deps._roster.upsertAgent.mock.calls[0][6] as Record<string, unknown>;
      expect(metadata.imported).toBe(true);
      expect(metadata.importedAt).toBeTruthy();
      expect(metadata.originalName).toBe('dev-alpha');
      expect(metadata.autopilot).toBe(true);
    });

    it('imports knowledge entries with metadata', () => {
      const bundle = makeBundle();
      importer.import(bundle, DEFAULT_OPTIONS);

      expect(deps._knowledge.put).toHaveBeenCalledTimes(2);
      const firstCall = deps._knowledge.put.mock.calls[0];
      expect(firstCall[0]).toBe('target-proj');
      expect(firstCall[1]).toBe('core');
      expect(firstCall[2]).toBe('project-rules');
      expect(firstCall[3]).toBe('Follow TDD');
      expect(firstCall[4]).toMatchObject({ imported: true, confidence: 0.9, tags: ['rules'] });
    });

    it('imports corrections via TrainingCapture', () => {
      const bundle = makeBundle();
      importer.import(bundle, DEFAULT_OPTIONS);

      expect(deps._training.captureCorrection).toHaveBeenCalledWith('target-proj', {
        agentId: 'dev-alpha',
        originalAction: 'used merge',
        correctedAction: 'use rebase',
        context: undefined,
      });
    });

    it('imports feedback via TrainingCapture', () => {
      const bundle = makeBundle();
      importer.import(bundle, DEFAULT_OPTIONS);

      expect(deps._training.captureFeedback).toHaveBeenCalledWith('target-proj', {
        agentId: 'arch-beta',
        action: 'good API design',
        rating: 'positive',
        comment: undefined,
      });
    });

    it('uses bundle sourceTeamId as default teamId', () => {
      const bundle = makeBundle();
      const report = importer.import(bundle, { projectId: 'proj' });
      expect(report.teamId).toBe('source-team');
    });

    it('returns unique agent IDs', () => {
      const bundle = makeBundle();
      const report = importer.import(bundle, DEFAULT_OPTIONS);
      const ids = report.agents.map(a => a.newAgentId);
      expect(new Set(ids).size).toBe(2);
      expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });
  });

  describe('validation failure', () => {
    it('rejects invalid bundle and returns failure report', () => {
      const report = importer.import(null, DEFAULT_OPTIONS);
      expect(report.success).toBe(false);
      expect(report.validation.valid).toBe(false);
      expect(report.agents).toHaveLength(0);
    });

    it('does not write anything on validation failure', () => {
      importer.import({ not: 'a bundle' }, DEFAULT_OPTIONS);
      expect(deps._roster.upsertAgent).not.toHaveBeenCalled();
      expect(deps._knowledge.put).not.toHaveBeenCalled();
      expect(deps._training.captureCorrection).not.toHaveBeenCalled();
    });

    it('includes validation issues in warnings', () => {
      const report = importer.import(null, DEFAULT_OPTIONS);
      expect(report.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('agent conflict resolution', () => {
    it('renames conflicting agents by default', () => {
      const bundle = makeBundle({ agents: [{ name: 'dev-alpha', role: 'developer', model: 'fast', status: 'idle', config: {} }] });

      // Pre-populate roster with an existing agent
      deps._roster._agents.push({ agentId: 'existing', role: 'dev-alpha', model: 'fast', status: 'idle', projectId: 'target-proj', teamId: 'target-team' });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, agentConflict: 'rename' });
      expect(report.success).toBe(true);
      expect(report.agents[0].action).toBe('renamed');
      expect(report.agents[0].renamedTo).toBe('dev-alpha-2');
    });

    it('skips conflicting agents with skip strategy', () => {
      const bundle = makeBundle({ agents: [{ name: 'dev-alpha', role: 'developer', model: 'fast', status: 'idle', config: {} }] });
      deps._roster._agents.push({ agentId: 'existing', role: 'dev-alpha', model: 'fast', status: 'idle', projectId: 'target-proj', teamId: 'target-team' });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, agentConflict: 'skip' });
      expect(report.agents[0].action).toBe('skipped');
      // Should not create agent
      expect(deps._roster.upsertAgent).not.toHaveBeenCalled();
    });

    it('overwrites conflicting agents with overwrite strategy', () => {
      const bundle = makeBundle({ agents: [{ name: 'dev-alpha', role: 'developer', model: 'fast', status: 'idle', config: {} }] });
      deps._roster._agents.push({ agentId: 'existing', role: 'dev-alpha', model: 'fast', status: 'idle', projectId: 'target-proj', teamId: 'target-team' });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, agentConflict: 'overwrite' });
      expect(report.agents[0].action).toBe('overwritten');
      expect(deps._roster.upsertAgent).toHaveBeenCalled();
    });
  });

  describe('knowledge conflict resolution', () => {
    it('keeps both entries with keep_both strategy (default)', () => {
      const bundle = makeBundle();
      // Pre-populate knowledge
      deps._knowledge._entries.set('target-proj:core:project-rules', {
        projectId: 'target-proj', category: 'core', key: 'project-rules', content: 'Existing',
      });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, knowledgeConflict: 'keep_both' });
      expect(report.knowledge.conflicts).toBe(1);
      expect(report.knowledge.imported).toBe(2); // 1 conflict (renamed) + 1 non-conflict
      expect(report.warnings.some(w => w.includes('imported as'))).toBe(true);
    });

    it('skips conflicts with skip strategy', () => {
      const bundle = makeBundle();
      deps._knowledge._entries.set('target-proj:core:project-rules', {
        projectId: 'target-proj', category: 'core', key: 'project-rules', content: 'Existing',
      });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, knowledgeConflict: 'skip' });
      expect(report.knowledge.skipped).toBe(1);
      expect(report.knowledge.imported).toBe(1); // Only the non-conflicting one
    });

    it('overwrites with prefer_import strategy', () => {
      const bundle = makeBundle();
      deps._knowledge._entries.set('target-proj:core:project-rules', {
        projectId: 'target-proj', category: 'core', key: 'project-rules', content: 'Existing',
      });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, knowledgeConflict: 'prefer_import' });
      expect(report.knowledge.conflicts).toBe(1);
      expect(report.knowledge.imported).toBe(2); // Both imported (conflict overwritten)
    });

    it('keeps existing with prefer_existing strategy', () => {
      const bundle = makeBundle();
      deps._knowledge._entries.set('target-proj:core:project-rules', {
        projectId: 'target-proj', category: 'core', key: 'project-rules', content: 'Existing',
      });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, knowledgeConflict: 'prefer_existing' });
      expect(report.knowledge.skipped).toBe(1);
      expect(report.knowledge.imported).toBe(1);
    });
  });

  describe('dry-run mode', () => {
    it('reports what would happen without writing', () => {
      const bundle = makeBundle();
      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, dryRun: true });

      expect(report.success).toBe(true);
      expect(report.agents).toHaveLength(2);
      expect(report.agents[0].action).toBe('created');
      expect(report.agents[0].newAgentId).toBe('(dry-run)');

      // No actual writes
      expect(deps._roster.upsertAgent).not.toHaveBeenCalled();
      expect(deps._knowledge.put).not.toHaveBeenCalled();
      expect(deps._training.captureCorrection).not.toHaveBeenCalled();
    });

    it('reflects conflicts in dry-run report', () => {
      const bundle = makeBundle();
      deps._roster._agents.push({ agentId: 'existing', role: 'dev-alpha', model: 'fast', status: 'idle', projectId: 'target-proj', teamId: 'target-team' });

      const report = importer.import(bundle, { ...DEFAULT_OPTIONS, dryRun: true, agentConflict: 'skip' });
      expect(report.agents[0].action).toBe('skipped');
      expect(report.agents[1].action).toBe('created');
    });
  });

  describe('error handling', () => {
    it('handles training capture failures gracefully', () => {
      const bundle = makeBundle();
      deps._training.captureCorrection.mockImplementation(() => { throw new Error('DB full'); });
      deps._training.captureFeedback.mockImplementation(() => { throw new Error('DB full'); });

      const report = importer.import(bundle, DEFAULT_OPTIONS);
      expect(report.success).toBe(true);
      expect(report.training.correctionsImported).toBe(0);
      expect(report.training.feedbackImported).toBe(0);
    });

    it('returns failure report on roster error', () => {
      const bundle = makeBundle();
      deps._roster.upsertAgent.mockImplementation(() => { throw new Error('constraint violation'); });

      const report = importer.import(bundle, DEFAULT_OPTIONS);
      expect(report.success).toBe(false);
      expect(report.warnings.some(w => w.includes('constraint violation'))).toBe(true);
    });

    it('empty bundle imports successfully with zero counts', () => {
      const bundle = makeBundle({
        agents: [],
        knowledge: { core: [], episodic: [], procedural: [], semantic: [] },
        corrections: [],
        feedback: [],
      });
      const report = importer.import(bundle, DEFAULT_OPTIONS);
      expect(report.success).toBe(true);
      expect(report.agents).toHaveLength(0);
      expect(report.knowledge.imported).toBe(0);
      expect(report.training.correctionsImported).toBe(0);
    });
  });
});
