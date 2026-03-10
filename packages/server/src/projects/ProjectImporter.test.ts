import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectImporter } from './ProjectImporter.js';
import type { ProjectImporterDeps } from './ProjectImporter.js';
import { createProjectManifest } from './project-bundle.js';
import type { ProjectBundle } from './project-bundle.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockDeps(): ProjectImporterDeps {
  return {
    knowledgeStore: { put: vi.fn() } as unknown as ProjectImporterDeps['knowledgeStore'],
    collectiveMemory: { remember: vi.fn() } as unknown as ProjectImporterDeps['collectiveMemory'],
    agentMemory: { store: vi.fn() } as unknown as ProjectImporterDeps['agentMemory'],
    agentRoster: { upsertAgent: vi.fn() } as unknown as ProjectImporterDeps['agentRoster'],
    projectRegistry: {
      create: vi.fn().mockReturnValue({
        id: 'new-project-id',
        name: 'Test Project',
        description: '',
        cwd: '/tmp/test',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
      getSessions: vi.fn().mockReturnValue([]),
      startSession: vi.fn(),
    } as unknown as ProjectImporterDeps['projectRegistry'],
    trainingCapture: {
      captureCorrection: vi.fn(),
      captureFeedback: vi.fn(),
    } as unknown as ProjectImporterDeps['trainingCapture'],
  };
}

function makeBundle(overrides: Partial<Omit<ProjectBundle, 'manifest'>> = {}): ProjectBundle {
  const content = {
    project: { name: 'Test Project', description: 'Test desc', cwd: '/tmp/test', status: 'active' as const },
    agents: [] as ProjectBundle['agents'],
    knowledge: { core: [], episodic: [], procedural: [], semantic: [] } as ProjectBundle['knowledge'],
    collectiveMemory: [] as ProjectBundle['collectiveMemory'],
    agentMemory: [] as ProjectBundle['agentMemory'],
    sessions: [] as ProjectBundle['sessions'],
    training: { corrections: [], feedback: [] } as ProjectBundle['training'],
    ...overrides,
  };
  return { manifest: createProjectManifest(content, 'source-project-id'), ...content };
}

describe('ProjectImporter', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let importer: ProjectImporter;

  beforeEach(() => {
    deps = createMockDeps();
    importer = new ProjectImporter(deps);
  });

  // ── Validation ────────────────────────────────────────

  describe('validation', () => {
    it('rejects null bundle', () => {
      const report = importer.import(null);
      expect(report.success).toBe(false);
      expect(report.validation.valid).toBe(false);
      expect(report.validation.issues).toContain('Bundle must be a non-null object');
    });

    it('rejects undefined bundle', () => {
      const report = importer.import(undefined);
      expect(report.success).toBe(false);
      expect(report.validation.valid).toBe(false);
    });

    it('rejects bundle with invalid manifest', () => {
      const report = importer.import({ manifest: { bundleType: 'wrong' }, project: {}, knowledge: {} });
      expect(report.success).toBe(false);
      expect(report.validation.issues).toContain('Invalid or missing manifest');
    });

    it('rejects bundle with bad checksum', () => {
      const bundle = makeBundle();
      // Tamper with content after checksum was computed
      bundle.project.name = 'Tampered Name';

      const report = importer.import(bundle);
      expect(report.success).toBe(false);
      expect(report.validation.issues[0]).toMatch(/[Cc]hecksum/);
    });

    it('accepts valid bundle', () => {
      const bundle = makeBundle();
      const report = importer.import(bundle);
      expect(report.success).toBe(true);
      expect(report.validation.valid).toBe(true);
    });
  });

  // ── Project creation ──────────────────────────────────

  describe('project creation', () => {
    it('creates project with bundle metadata', () => {
      const bundle = makeBundle();
      importer.import(bundle);

      expect(deps.projectRegistry.create).toHaveBeenCalledWith(
        'Test Project',
        'Test desc',
        '/tmp/test',
      );
    });

    it('creates project with overridden name and cwd', () => {
      const bundle = makeBundle();
      importer.import(bundle, { name: 'Custom Name', cwd: '/custom/path' });

      expect(deps.projectRegistry.create).toHaveBeenCalledWith(
        'Custom Name',
        'Test desc',
        '/custom/path',
      );
    });

    it('returns failure if project creation throws', () => {
      (deps.projectRegistry.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Duplicate project name');
      });

      const bundle = makeBundle();
      const report = importer.import(bundle);

      expect(report.success).toBe(false);
      expect(report.warnings[0]).toMatch(/Failed to create project/);
    });
  });

  // ── Knowledge import ──────────────────────────────────

  describe('knowledge import', () => {
    it('imports knowledge entries across all categories', () => {
      const bundle = makeBundle({
        knowledge: {
          core: [
            { key: 'arch', content: 'Use microservices', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
          ],
          semantic: [
            { key: 'glossary', content: 'Domain terms', category: 'semantic', confidence: 0.8, tags: ['domain'], source: 'manual', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
          ],
          episodic: [],
          procedural: [],
        },
      });

      const report = importer.import(bundle);

      expect(report.knowledge.imported).toBe(2);
      expect(deps.knowledgeStore.put).toHaveBeenCalledTimes(2);
      expect(deps.knowledgeStore.put).toHaveBeenCalledWith(
        'new-project-id', 'core', 'arch', 'Use microservices',
        expect.objectContaining({ imported: true }),
      );
      expect(deps.knowledgeStore.put).toHaveBeenCalledWith(
        'new-project-id', 'semantic', 'glossary', 'Domain terms',
        expect.objectContaining({ imported: true, confidence: 0.8, tags: ['domain'], source: 'manual' }),
      );
    });

    it('skips invalid knowledge entries missing key', () => {
      const bundle = makeBundle({
        knowledge: {
          core: [
            { key: '', content: 'No key', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
            { key: 'valid', content: 'Has key', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
          ],
          episodic: [],
          procedural: [],
          semantic: [],
        },
      });

      const report = importer.import(bundle);
      expect(report.knowledge.imported).toBe(1);
      expect(report.knowledge.skipped).toBe(1);
    });

    it('adds imported:true to metadata', () => {
      const bundle = makeBundle({
        knowledge: {
          core: [
            { key: 'k1', content: 'c1', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
          ],
          episodic: [],
          procedural: [],
          semantic: [],
        },
      });

      importer.import(bundle);

      const putCall = (deps.knowledgeStore.put as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(putCall[4]).toMatchObject({ imported: true });
    });
  });

  // ── Collective memory import ──────────────────────────

  describe('collective memory import', () => {
    it('imports collective memory entries', () => {
      const bundle = makeBundle({
        collectiveMemory: [
          { category: 'pattern', key: 'retry', value: 'Use backoff', source: 'agent-1', useCount: 3 },
          { category: 'decision', key: 'db', value: 'SQLite', source: 'lead', useCount: 1 },
        ],
      });

      const report = importer.import(bundle);

      expect(report.collectiveMemory.imported).toBe(2);
      expect(deps.collectiveMemory.remember).toHaveBeenCalledWith(
        'pattern', 'retry', 'Use backoff', 'agent-1', 'new-project-id',
      );
    });

    it('skips unknown memory categories', () => {
      const bundle = makeBundle({
        collectiveMemory: [
          { category: 'unknown-category', key: 'k', value: 'v', source: 's', useCount: 0 },
        ],
      });

      const report = importer.import(bundle);
      expect(report.collectiveMemory.skipped).toBe(1);
      expect(deps.collectiveMemory.remember).not.toHaveBeenCalled();
    });
  });

  // ── Agent memory import ───────────────────────────────

  describe('agent memory import', () => {
    it('imports agent memory entries', () => {
      const bundle = makeBundle({
        agentMemory: [
          { leadId: 'lead-1', agentId: 'agent-1', key: 'pref', value: 'dark-mode' },
          { leadId: 'lead-2', agentId: 'agent-2', key: 'lang', value: 'typescript' },
        ],
      });

      const report = importer.import(bundle);

      expect(report.agentMemory.imported).toBe(2);
      expect(deps.agentMemory.store).toHaveBeenCalledWith('lead-1', 'agent-1', 'pref', 'dark-mode');
      expect(deps.agentMemory.store).toHaveBeenCalledWith('lead-2', 'agent-2', 'lang', 'typescript');
    });

    it('skips invalid agent memory entries', () => {
      const bundle = makeBundle({
        agentMemory: [
          { leadId: '', agentId: 'agent-1', key: 'k', value: 'v' },
          { leadId: 'lead-1', agentId: 'agent-1', key: 'k', value: 'v' },
        ],
      });

      const report = importer.import(bundle);
      expect(report.agentMemory.imported).toBe(1);
      expect(report.agentMemory.skipped).toBe(1);
    });
  });

  // ── Agent import ──────────────────────────────────────

  describe('agent import', () => {
    it('imports agents as terminated with remapped projectId', () => {
      const bundle = makeBundle({
        agents: [
          {
            agentId: 'agent-1',
            role: 'developer',
            model: 'gpt-4',
            status: 'active',
            teamId: 'team-1',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const report = importer.import(bundle);

      expect(report.agents.imported).toBe(1);
      expect(deps.agentRoster.upsertAgent).toHaveBeenCalledWith(
        'agent-1',
        'developer',
        'gpt-4',
        'terminated',
        undefined,
        'new-project-id',
        expect.objectContaining({ imported: true }),
        'team-1',
      );
    });

    it('skips invalid agent entries', () => {
      const bundle = makeBundle({
        agents: [
          { agentId: '', role: 'dev', model: 'gpt-4', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
          { agentId: 'a1', role: '', model: 'gpt-4', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
          { agentId: 'a2', role: 'dev', model: '', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
        ],
      });

      const report = importer.import(bundle);
      expect(report.agents.skipped).toBe(3);
      expect(report.agents.imported).toBe(0);
    });
  });

  // ── Session import ────────────────────────────────────

  describe('session import', () => {
    it('imports sessions', () => {
      const bundle = makeBundle({
        sessions: [
          { leadId: 'lead-1', task: 'build', role: 'dev' },
          { leadId: 'lead-2', task: 'test', role: 'qa' },
        ],
      });

      const report = importer.import(bundle);

      expect(report.sessions.imported).toBe(2);
      expect(deps.projectRegistry.startSession).toHaveBeenCalledWith(
        'new-project-id', 'lead-1', 'build', 'dev',
      );
      expect(deps.projectRegistry.startSession).toHaveBeenCalledWith(
        'new-project-id', 'lead-2', 'test', 'qa',
      );
    });

    it('skips duplicate sessions', () => {
      (deps.projectRegistry.getSessions as ReturnType<typeof vi.fn>).mockReturnValue([
        { leadId: 'lead-1', task: 'build' },
      ]);

      const bundle = makeBundle({
        sessions: [
          { leadId: 'lead-1', task: 'build', role: 'dev' },
          { leadId: 'lead-2', task: 'test', role: 'qa' },
        ],
      });

      const report = importer.import(bundle);

      expect(report.sessions.imported).toBe(1);
      expect(report.sessions.skipped).toBe(1);
      expect(deps.projectRegistry.startSession).toHaveBeenCalledTimes(1);
    });
  });

  // ── Training import ───────────────────────────────────

  describe('training import', () => {
    it('imports corrections and feedback', () => {
      const bundle = makeBundle({
        training: {
          corrections: [
            {
              id: 'corr-1',
              agentId: 'agent-1',
              originalAction: 'delete file',
              correctedAction: 'archive file',
              context: 'production',
              tags: ['safety'],
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          feedback: [
            {
              id: 'fb-1',
              agentId: 'agent-2',
              action: 'code review',
              rating: 'positive' as const,
              comment: 'Good',
              tags: ['quality'],
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const report = importer.import(bundle);

      expect(report.training.imported).toBe(2);
      expect(deps.trainingCapture.captureCorrection).toHaveBeenCalledWith(
        'new-project-id',
        expect.objectContaining({
          agentId: 'agent-1',
          originalAction: 'delete file',
          correctedAction: 'archive file',
        }),
      );
      expect(deps.trainingCapture.captureFeedback).toHaveBeenCalledWith(
        'new-project-id',
        expect.objectContaining({
          agentId: 'agent-2',
          action: 'code review',
          rating: 'positive',
        }),
      );
    });
  });

  // ── Dry run ───────────────────────────────────────────

  describe('dry run', () => {
    it('does not write when dryRun is true', () => {
      const bundle = makeBundle({
        agents: [{ agentId: 'a1', role: 'dev', model: 'gpt-4', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' }],
        knowledge: {
          core: [{ key: 'k1', content: 'c1', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
          episodic: [],
          procedural: [],
          semantic: [],
        },
        collectiveMemory: [{ category: 'pattern', key: 'k', value: 'v', source: 's', useCount: 0 }],
        agentMemory: [{ leadId: 'l1', agentId: 'a1', key: 'k', value: 'v' }],
        sessions: [{ leadId: 'lead-1', task: 'build' }],
        training: {
          corrections: [{ id: 'c1', agentId: 'a1', originalAction: 'x', correctedAction: 'y', tags: [], timestamp: '2024-01-01T00:00:00Z' }],
          feedback: [],
        },
      });

      const report = importer.import(bundle, { dryRun: true });

      expect(report.success).toBe(true);
      expect(report.project.created).toBe(false);
      expect(deps.projectRegistry.create).not.toHaveBeenCalled();
      expect(deps.knowledgeStore.put).not.toHaveBeenCalled();
      expect(deps.collectiveMemory.remember).not.toHaveBeenCalled();
      expect(deps.agentMemory.store).not.toHaveBeenCalled();
      expect(deps.agentRoster.upsertAgent).not.toHaveBeenCalled();
      expect(deps.projectRegistry.startSession).not.toHaveBeenCalled();
      expect(deps.trainingCapture.captureCorrection).not.toHaveBeenCalled();
    });

    it('returns counts of what would be imported', () => {
      const bundle = makeBundle({
        agents: [
          { agentId: 'a1', role: 'dev', model: 'gpt-4', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
          { agentId: 'a2', role: 'qa', model: 'gpt-4', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
        ],
        knowledge: {
          core: [{ key: 'k1', content: 'c1', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
          episodic: [],
          procedural: [{ key: 'k2', content: 'c2', category: 'procedural', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
          semantic: [],
        },
        collectiveMemory: [
          { category: 'pattern', key: 'k', value: 'v', source: 's', useCount: 0 },
        ],
        agentMemory: [
          { leadId: 'l1', agentId: 'a1', key: 'k', value: 'v' },
          { leadId: 'l2', agentId: 'a2', key: 'k', value: 'v' },
          { leadId: 'l3', agentId: 'a3', key: 'k', value: 'v' },
        ],
        sessions: [{ leadId: 'lead-1' }],
        training: {
          corrections: [{ id: 'c1', agentId: 'a1', originalAction: 'x', correctedAction: 'y', tags: [], timestamp: '2024-01-01T00:00:00Z' }],
          feedback: [{ id: 'f1', agentId: 'a1', action: 'act', rating: 'positive' as const, tags: [], timestamp: '2024-01-01T00:00:00Z' }],
        },
      });

      const report = importer.import(bundle, { dryRun: true });

      expect(report.agents.imported).toBe(2);
      expect(report.knowledge.imported).toBe(2);
      expect(report.collectiveMemory.imported).toBe(1);
      expect(report.agentMemory.imported).toBe(3);
      expect(report.sessions.imported).toBe(1);
      expect(report.training.imported).toBe(2);
    });
  });

  // ── End-to-end ────────────────────────────────────────

  describe('end-to-end', () => {
    it('full bundle import with all sections populated', () => {
      const bundle = makeBundle({
        agents: [
          { agentId: 'a1', role: 'dev', model: 'gpt-4', status: 'active', teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
        ],
        knowledge: {
          core: [{ key: 'arch', content: 'microservices', category: 'core', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
          episodic: [{ key: 'ep1', content: 'learned x', category: 'episodic', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
          procedural: [],
          semantic: [{ key: 'sem1', content: 'terms', category: 'semantic', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' }],
        },
        collectiveMemory: [
          { category: 'pattern', key: 'retry', value: 'backoff', source: 'agent-1', useCount: 3 },
        ],
        agentMemory: [
          { leadId: 'lead-1', agentId: 'agent-1', key: 'pref', value: 'dark-mode' },
        ],
        sessions: [
          { leadId: 'lead-1', task: 'build', role: 'dev' },
        ],
        training: {
          corrections: [
            { id: 'c1', agentId: 'a1', originalAction: 'delete', correctedAction: 'archive', tags: ['safety'], timestamp: '2024-01-01T00:00:00Z' },
          ],
          feedback: [
            { id: 'f1', agentId: 'a1', action: 'review', rating: 'positive' as const, tags: [], timestamp: '2024-01-01T00:00:00Z' },
          ],
        },
      });

      const report = importer.import(bundle);

      expect(report.success).toBe(true);
      expect(report.projectId).toBe('new-project-id');
      expect(report.project.created).toBe(true);
      expect(report.agents.imported).toBe(1);
      expect(report.knowledge.imported).toBe(3);
      expect(report.collectiveMemory.imported).toBe(1);
      expect(report.agentMemory.imported).toBe(1);
      expect(report.sessions.imported).toBe(1);
      expect(report.training.imported).toBe(2);
    });
  });
});
