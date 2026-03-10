import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectExporter } from './ProjectExporter.js';
import type { ProjectExporterDeps } from './ProjectExporter.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockDeps(): ProjectExporterDeps {
  return {
    projectRegistry: {
      get: vi.fn(),
      getSessions: vi.fn().mockReturnValue([]),
    } as unknown as ProjectExporterDeps['projectRegistry'],
    agentRoster: {
      getAllAgents: vi.fn().mockReturnValue([]),
    } as unknown as ProjectExporterDeps['agentRoster'],
    agentMemory: {
      getByLead: vi.fn().mockReturnValue([]),
    } as unknown as ProjectExporterDeps['agentMemory'],
    collectiveMemory: {
      getAll: vi.fn().mockReturnValue([]),
    } as unknown as ProjectExporterDeps['collectiveMemory'],
    knowledgeStore: {
      getByCategory: vi.fn().mockReturnValue([]),
    } as unknown as ProjectExporterDeps['knowledgeStore'],
    trainingCapture: {
      getCorrections: vi.fn().mockReturnValue([]),
      getFeedback: vi.fn().mockReturnValue([]),
    } as unknown as ProjectExporterDeps['trainingCapture'],
  };
}

describe('ProjectExporter', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let exporter: ProjectExporter;
  const PROJECT_ID = 'proj-123';

  beforeEach(() => {
    deps = createMockDeps();
    exporter = new ProjectExporter(deps);

    // Default: project exists
    (deps.projectRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue({
      id: PROJECT_ID,
      name: 'Test Project',
      description: 'A test project',
      cwd: '/tmp/test',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
  });

  describe('exportBundle', () => {
    it('exports project metadata', () => {
      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.project).toEqual({
        name: 'Test Project',
        description: 'A test project',
        cwd: '/tmp/test',
        status: 'active',
      });
    });

    it('exports agents filtered by projectId', () => {
      (deps.agentRoster.getAllAgents as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          agentId: 'agent-1',
          role: 'developer',
          model: 'gpt-4',
          status: 'active',
          projectId: PROJECT_ID,
          teamId: 'team-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          agentId: 'agent-2',
          role: 'reviewer',
          model: 'gpt-4',
          status: 'active',
          projectId: 'other-project',
          teamId: 'team-2',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          agentId: 'agent-3',
          role: 'tester',
          model: 'claude-3',
          status: 'terminated',
          projectId: PROJECT_ID,
          sessionId: 'sess-1',
          teamId: 'team-1',
          lastTaskSummary: 'Ran tests',
          metadata: { foo: 'bar' },
          createdAt: '2024-01-02T00:00:00Z',
        },
      ]);

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.agents).toHaveLength(2);
      expect(bundle.agents[0].agentId).toBe('agent-1');
      expect(bundle.agents[1].agentId).toBe('agent-3');
      expect(bundle.agents[1]).toMatchObject({
        role: 'tester',
        model: 'claude-3',
        status: 'terminated',
        sessionId: 'sess-1',
        teamId: 'team-1',
        lastTaskSummary: 'Ran tests',
        metadata: { foo: 'bar' },
      });
    });

    it('exports knowledge by category', () => {
      (deps.knowledgeStore.getByCategory as ReturnType<typeof vi.fn>).mockImplementation(
        (_projectId: string, category: string) => {
          if (category === 'core') {
            return [
              {
                key: 'arch-decisions',
                content: 'Use event sourcing',
                category: 'core',
                metadata: { confidence: 0.9, tags: ['architecture'], source: 'manual' },
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            ];
          }
          if (category === 'semantic') {
            return [
              {
                key: 'glossary',
                content: 'Domain terms',
                category: 'semantic',
                metadata: {},
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            ];
          }
          return [];
        },
      );

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.knowledge.core).toHaveLength(1);
      expect(bundle.knowledge.core[0]).toMatchObject({
        key: 'arch-decisions',
        content: 'Use event sourcing',
        category: 'core',
        confidence: 0.9,
        tags: ['architecture'],
        source: 'manual',
      });
      expect(bundle.knowledge.semantic).toHaveLength(1);
      expect(bundle.knowledge.procedural).toHaveLength(0);
      expect(bundle.knowledge.episodic).toHaveLength(0);
    });

    it('exports collective memory', () => {
      (deps.collectiveMemory.getAll as ReturnType<typeof vi.fn>).mockReturnValue([
        { category: 'pattern', key: 'retry-pattern', value: 'Use exponential backoff', source: 'agent-1', useCount: 3 },
        { category: 'decision', key: 'db-choice', value: 'Use SQLite', source: 'lead', useCount: 1 },
      ]);

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.collectiveMemory).toHaveLength(2);
      expect(bundle.collectiveMemory[0]).toEqual({
        category: 'pattern',
        key: 'retry-pattern',
        value: 'Use exponential backoff',
        source: 'agent-1',
        useCount: 3,
      });
    });

    it('exports agent memory from session leads', () => {
      (deps.projectRegistry.getSessions as ReturnType<typeof vi.fn>).mockReturnValue([
        { leadId: 'lead-1', sessionId: 'sess-1', role: 'dev', task: 'build', status: 'ended' },
        { leadId: 'lead-2', sessionId: 'sess-2', role: 'qa', task: 'test', status: 'active' },
      ]);

      (deps.agentMemory.getByLead as ReturnType<typeof vi.fn>).mockImplementation(
        (leadId: string) => {
          if (leadId === 'lead-1') {
            return [{ leadId: 'lead-1', agentId: 'agent-1', key: 'pref', value: 'dark-mode' }];
          }
          if (leadId === 'lead-2') {
            return [
              { leadId: 'lead-2', agentId: 'agent-2', key: 'lang', value: 'typescript' },
              { leadId: 'lead-2', agentId: 'agent-3', key: 'style', value: 'functional' },
            ];
          }
          return [];
        },
      );

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.agentMemory).toHaveLength(3);
      expect(deps.agentMemory.getByLead).toHaveBeenCalledWith('lead-1');
      expect(deps.agentMemory.getByLead).toHaveBeenCalledWith('lead-2');
      expect(bundle.agentMemory[0]).toEqual({
        leadId: 'lead-1',
        agentId: 'agent-1',
        key: 'pref',
        value: 'dark-mode',
      });
    });

    it('exports sessions', () => {
      const sessions = [
        { leadId: 'lead-1', sessionId: 'sess-1', role: 'dev', task: 'build', status: 'ended', startedAt: '2024-01-01T00:00:00Z', endedAt: '2024-01-01T01:00:00Z' },
        { leadId: 'lead-2', sessionId: null, role: null, task: null, status: 'active', startedAt: '2024-01-02T00:00:00Z', endedAt: null },
      ];
      (deps.projectRegistry.getSessions as ReturnType<typeof vi.fn>).mockReturnValue(sessions);

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.sessions).toHaveLength(2);
      expect(bundle.sessions[0]).toEqual({
        leadId: 'lead-1',
        sessionId: 'sess-1',
        role: 'dev',
        task: 'build',
        status: 'ended',
        startedAt: '2024-01-01T00:00:00Z',
        endedAt: '2024-01-01T01:00:00Z',
      });
      // null values become undefined
      expect(bundle.sessions[1].sessionId).toBeUndefined();
      expect(bundle.sessions[1].role).toBeUndefined();
    });

    it('exports training data', () => {
      (deps.trainingCapture.getCorrections as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          id: 'corr-1',
          agentId: 'agent-1',
          originalAction: 'delete file',
          correctedAction: 'archive file',
          context: 'production',
          tags: ['safety'],
          timestamp: '2024-01-01T00:00:00Z',
        },
      ]);
      (deps.trainingCapture.getFeedback as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          id: 'fb-1',
          agentId: 'agent-2',
          action: 'code review',
          rating: 'positive',
          comment: 'Good catch',
          tags: ['quality'],
          timestamp: '2024-01-01T00:00:00Z',
        },
      ]);

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.training.corrections).toHaveLength(1);
      expect(bundle.training.corrections[0]).toMatchObject({
        id: 'corr-1',
        agentId: 'agent-1',
        originalAction: 'delete file',
        correctedAction: 'archive file',
      });
      expect(bundle.training.feedback).toHaveLength(1);
      expect(bundle.training.feedback[0]).toMatchObject({
        id: 'fb-1',
        rating: 'positive',
      });
    });

    it('includes valid manifest with checksum', () => {
      (deps.agentRoster.getAllAgents as ReturnType<typeof vi.fn>).mockReturnValue([
        { agentId: 'a-1', role: 'dev', model: 'gpt-4', status: 'active', projectId: PROJECT_ID, teamId: 't1', createdAt: '2024-01-01T00:00:00Z' },
      ]);
      (deps.knowledgeStore.getByCategory as ReturnType<typeof vi.fn>).mockReturnValue([
        { key: 'k1', content: 'c1', category: 'core', metadata: {}, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ]);

      const bundle = exporter.exportBundle(PROJECT_ID);

      expect(bundle.manifest.bundleType).toBe('project');
      expect(bundle.manifest.sourceProjectId).toBe(PROJECT_ID);
      expect(bundle.manifest.sourceProjectName).toBe('Test Project');
      expect(bundle.manifest.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(bundle.manifest.stats.agentCount).toBe(1);
      // 4 categories each return 1 entry
      expect(bundle.manifest.stats.knowledgeCount).toBe(4);
    });

    it('throws if project not found', () => {
      (deps.projectRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      expect(() => exporter.exportBundle(PROJECT_ID)).toThrow('Project not found: proj-123');
    });
  });
});
