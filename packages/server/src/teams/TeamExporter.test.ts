/**
 * TeamExporter tests.
 *
 * Covers: in-memory export, directory export, agent filtering,
 * knowledge category filtering, training export, options handling,
 * and empty project edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { TeamExporter } from './TeamExporter.js';
import { verifyChecksum } from './bundle-format.js';
import type { TeamExporterDeps } from './TeamExporter.js';
import type { KnowledgeCategory } from './bundle-format.js';

// ── Mock Data ───────────────────────────────────────────────────────

const AGENTS = [
  {
    agentId: 'agent-1',
    role: 'architect',
    model: 'claude-sonnet-4.5',
    status: 'idle' as const,
    sessionId: 'sess-1',
    projectId: 'proj-1',
    teamId: 'team-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T12:00:00Z',
    lastTaskSummary: 'Designed system architecture',
    metadata: { specialization: ['system design'] },
  },
  {
    agentId: 'agent-2',
    role: 'developer',
    model: 'gpt-4',
    status: 'running' as const,
    projectId: 'proj-1',
    teamId: 'team-1',
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T12:00:00Z',
    metadata: {},
  },
  {
    agentId: 'agent-3',
    role: 'reviewer',
    model: 'gpt-4',
    status: 'idle' as const,
    projectId: 'proj-2',
    teamId: 'team-2', // different team
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T12:00:00Z',
    metadata: {},
  },
];

const KNOWLEDGE_ENTRIES = {
  core: [
    { id: 1, projectId: 'proj-1', category: 'core', key: 'arch-pattern', content: 'Use monorepo', metadata: { confidence: 0.9, tags: ['architecture'] }, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ],
  procedural: [
    { id: 2, projectId: 'proj-1', category: 'procedural', key: 'deploy-steps', content: 'Run npm build first', metadata: { source: 'agent-1' }, createdAt: '2026-01-02', updatedAt: '2026-01-02' },
  ],
  semantic: [],
  episodic: [
    { id: 3, projectId: 'proj-1', category: 'episodic', key: 'session-1-learning', content: 'User prefers TypeScript', metadata: {}, createdAt: '2026-01-03', updatedAt: '2026-01-03' },
  ],
};

const CORRECTIONS = [
  {
    id: 'correction-1',
    projectId: 'proj-1',
    agentId: 'agent-1',
    originalAction: 'Used var',
    correctedAction: 'Use const',
    context: 'Code review',
    tags: ['style'],
    timestamp: '2026-01-01T00:00:00Z',
  },
];

const FEEDBACK = [
  {
    id: 'feedback-1',
    projectId: 'proj-1',
    agentId: 'agent-2',
    action: 'Wrote clean tests',
    rating: 'positive' as const,
    comment: 'Great test coverage',
    tags: ['testing'],
    timestamp: '2026-01-02T00:00:00Z',
  },
];

// ── Mock Dependencies ───────────────────────────────────────────────

function createMockDeps(): TeamExporterDeps {
  return {
    agentRoster: {
      getAllAgents: vi.fn(() => AGENTS),
      upsertAgent: vi.fn(),
      getAgent: vi.fn(),
      updateStatus: vi.fn(),
      updateSessionId: vi.fn(),
      updateLastTaskSummary: vi.fn(),
      removeAgent: vi.fn(),
      deleteAgent: vi.fn(),
    } as any,
    knowledgeStore: {
      getByCategory: vi.fn((projectId: string, category: string) => {
        return (KNOWLEDGE_ENTRIES as any)[category] ?? [];
      }),
      get: vi.fn(),
      put: vi.fn(),
      getAll: vi.fn(),
      search: vi.fn(),
      delete: vi.fn(),
      deleteAll: vi.fn(),
      count: vi.fn(),
    } as any,
    trainingCapture: {
      getCorrections: vi.fn(() => CORRECTIONS),
      getFeedback: vi.fn(() => FEEDBACK),
      captureCorrection: vi.fn(),
      captureFeedback: vi.fn(),
      getTrainingSummary: vi.fn(),
    } as any,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('TeamExporter', () => {
  let deps: TeamExporterDeps;
  let exporter: TeamExporter;

  beforeEach(() => {
    deps = createMockDeps();
    exporter = new TeamExporter(deps);
  });

  // ── In-Memory Export ──────────────────────────────────────────

  describe('exportBundle', () => {
    it('exports agents filtered by projectId', () => {
      const bundle = exporter.exportBundle('proj-1');

      // agent-3 is proj-2, should be excluded
      expect(bundle.agents).toHaveLength(2);
      expect(bundle.agents.map((a) => a.name)).toContain('agent-1');
      expect(bundle.agents.map((a) => a.name)).toContain('agent-2');
    });

    it('exports agent details correctly', () => {
      const bundle = exporter.exportBundle('proj-1');
      const arch = bundle.agents.find((a) => a.name === 'agent-1')!;

      expect(arch.role).toBe('architect');
      expect(arch.model).toBe('claude-sonnet-4.5');
      expect(arch.status).toBe('idle');
      expect(arch.sessionId).toBe('sess-1');
      expect(arch.config).toEqual({ specialization: ['system design'] });
      expect(arch.stats?.createdAt).toBe('2026-01-01T00:00:00Z');
      expect(arch.stats?.lastTaskSummary).toBe('Designed system architecture');
    });

    it('exports knowledge by category', () => {
      const bundle = exporter.exportBundle('proj-1');

      expect(bundle.knowledge.core).toHaveLength(1);
      expect(bundle.knowledge.core[0].key).toBe('arch-pattern');
      expect(bundle.knowledge.core[0].content).toBe('Use monorepo');
      expect(bundle.knowledge.core[0].confidence).toBe(0.9);

      expect(bundle.knowledge.procedural).toHaveLength(1);
      expect(bundle.knowledge.semantic).toHaveLength(0);
      expect(bundle.knowledge.episodic).toHaveLength(1);
    });

    it('exports training data', () => {
      const bundle = exporter.exportBundle('proj-1');

      expect(bundle.training.corrections).toHaveLength(1);
      expect(bundle.training.corrections[0].originalAction).toBe('Used var');
      expect(bundle.training.corrections[0].correctedAction).toBe('Use const');

      expect(bundle.training.feedback).toHaveLength(1);
      expect(bundle.training.feedback[0].rating).toBe('positive');
    });

    it('creates valid manifest with correct stats', () => {
      const bundle = exporter.exportBundle('proj-1');

      expect(bundle.manifest.bundleFormat).toBe('1.0');
      expect(bundle.manifest.sourceProjectId).toBe('proj-1');
      expect(bundle.manifest.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(bundle.manifest.stats.agentCount).toBe(2);
      expect(bundle.manifest.stats.knowledgeCount).toBe(3); // 1 core + 1 procedural + 1 episodic
      expect(bundle.manifest.stats.correctionCount).toBe(1);
      expect(bundle.manifest.stats.feedbackCount).toBe(1);
    });

    it('produces bundle with valid checksum', () => {
      const bundle = exporter.exportBundle('proj-1');
      expect(verifyChecksum(bundle)).toBe(true);
    });
  });

  // ── Export Options ────────────────────────────────────────────

  describe('options', () => {
    it('filters agents by agentIds', () => {
      const bundle = exporter.exportBundle('proj-1', { agentIds: ['agent-1'] });
      expect(bundle.agents).toHaveLength(1);
      expect(bundle.agents[0].name).toBe('agent-1');
    });

    it('excludes episodic knowledge when requested', () => {
      const bundle = exporter.exportBundle('proj-1', { excludeEpisodic: true });
      expect(bundle.knowledge.episodic).toHaveLength(0);
    });

    it('filters to specific knowledge categories', () => {
      const bundle = exporter.exportBundle('proj-1', { categories: ['core'] });

      // Only core category should be queried
      expect(deps.knowledgeStore.getByCategory).toHaveBeenCalledWith('proj-1', 'core');
      expect(bundle.knowledge.core).toHaveLength(1);
    });

    it('excludes knowledge when includeKnowledge=false', () => {
      const bundle = exporter.exportBundle('proj-1', { includeKnowledge: false });
      expect(bundle.knowledge.core).toHaveLength(0);
      expect(bundle.knowledge.procedural).toHaveLength(0);
      expect(bundle.knowledge.semantic).toHaveLength(0);
      expect(bundle.knowledge.episodic).toHaveLength(0);
    });

    it('excludes training when includeTraining=false', () => {
      const bundle = exporter.exportBundle('proj-1', { includeTraining: false });
      expect(bundle.training.corrections).toHaveLength(0);
      expect(bundle.training.feedback).toHaveLength(0);
    });
  });

  // ── Directory Export ──────────────────────────────────────────

  describe('exportToDirectory', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'team-export-test-'));
    });

    it('creates bundle directory structure', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);

      expect(result.outputDir).toBeTruthy();
      expect(result.outputDir!.endsWith('.flightdeck-team')).toBe(true);
      expect(existsSync(join(result.outputDir!, 'manifest.json'))).toBe(true);
      expect(existsSync(join(result.outputDir!, 'agents'))).toBe(true);
      expect(existsSync(join(result.outputDir!, 'knowledge'))).toBe(true);
      expect(existsSync(join(result.outputDir!, 'training'))).toBe(true);
    });

    it('writes valid manifest.json', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);
      const manifest = JSON.parse(readFileSync(join(result.outputDir!, 'manifest.json'), 'utf8'));

      expect(manifest.bundleFormat).toBe('1.0');
      expect(manifest.stats.agentCount).toBe(2);
    });

    it('writes per-agent JSON files', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);
      const agentsDir = join(result.outputDir!, 'agents');

      const agent1 = JSON.parse(readFileSync(join(agentsDir, 'agent-1.json'), 'utf8'));
      expect(agent1.role).toBe('architect');
      expect(agent1.model).toBe('claude-sonnet-4.5');
    });

    it('writes knowledge category files', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);
      const knowledgeDir = join(result.outputDir!, 'knowledge');

      expect(existsSync(join(knowledgeDir, 'core.json'))).toBe(true);
      expect(existsSync(join(knowledgeDir, 'procedural.json'))).toBe(true);
      // semantic is empty, no file written
      expect(existsSync(join(knowledgeDir, 'semantic.json'))).toBe(false);
    });

    it('writes training files', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);

      const corrections = JSON.parse(
        readFileSync(join(result.outputDir!, 'training', 'corrections.json'), 'utf8'),
      );
      expect(corrections).toHaveLength(1);
      expect(corrections[0].correctedAction).toBe('Use const');

      const feedback = JSON.parse(
        readFileSync(join(result.outputDir!, 'training', 'feedback.json'), 'utf8'),
      );
      expect(feedback).toHaveLength(1);
    });

    it('returns list of written files', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);
      expect(result.filesWritten!.length).toBeGreaterThan(0);
      expect(result.filesWritten!.some((f) => f.endsWith('manifest.json'))).toBe(true);
    });

    it('bundle checksum is valid', () => {
      const result = exporter.exportToDirectory('proj-1', tmpDir);
      expect(verifyChecksum(result.bundle)).toBe(true);
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles project with no agents', () => {
      (deps.agentRoster.getAllAgents as any).mockReturnValue([]);
      const bundle = exporter.exportBundle('proj-empty');
      expect(bundle.agents).toHaveLength(0);
      expect(bundle.manifest.stats.agentCount).toBe(0);
    });

    it('handles project with no knowledge', () => {
      (deps.knowledgeStore.getByCategory as any).mockReturnValue([]);
      const bundle = exporter.exportBundle('proj-empty');
      expect(bundle.knowledge.core).toHaveLength(0);
      expect(bundle.manifest.stats.knowledgeCount).toBe(0);
    });

    it('handles project with no training data', () => {
      (deps.trainingCapture.getCorrections as any).mockReturnValue([]);
      (deps.trainingCapture.getFeedback as any).mockReturnValue([]);
      const bundle = exporter.exportBundle('proj-empty');
      expect(bundle.training.corrections).toHaveLength(0);
      expect(bundle.training.feedback).toHaveLength(0);
    });

    it('sanitizes agent names for filenames', () => {
      (deps.agentRoster.getAllAgents as any).mockReturnValue([
        { agentId: 'Agent With Spaces!', role: 'dev', model: 'gpt-4', status: 'idle', projectId: 'proj-1', createdAt: '', updatedAt: '', metadata: {} },
      ]);
      const tmpDir = mkdtempSync(join(tmpdir(), 'team-export-name-'));
      const result = exporter.exportToDirectory('proj-1', tmpDir);
      const agentFiles = result.filesWritten!.filter((f) => f.includes('/agents/'));
      expect(agentFiles[0]).toContain('agent_with_spaces_');
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });
  });
});
