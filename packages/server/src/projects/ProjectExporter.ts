/**
 * ProjectExporter — exports all project data to a portable ProjectBundle.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeStore } from '../knowledge/KnowledgeStore.js';
import type { TrainingCapture } from '../knowledge/TrainingCapture.js';
import type { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import type { CollectiveMemory } from '../coordination/knowledge/CollectiveMemory.js';
import type { AgentMemory } from '../agents/AgentMemory.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
import { createProjectManifest } from './project-bundle.js';
import type {
  ProjectBundle,
  ProjectAgentExport,
  CollectiveMemoryExport,
  AgentMemoryExport,
  SessionExport,
  KnowledgeCategory,
  KnowledgeExport,
  CorrectionExport,
  FeedbackExport,
} from './project-bundle.js';
import { logger } from '../utils/logger.js';

const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['core', 'procedural', 'semantic', 'episodic'];
const BUNDLE_DIR_SUFFIX = '.flightdeck-project';

export interface ProjectExporterDeps {
  projectRegistry: ProjectRegistry;
  agentRoster: AgentRosterRepository;
  agentMemory: AgentMemory;
  collectiveMemory: CollectiveMemory;
  knowledgeStore: KnowledgeStore;
  trainingCapture: TrainingCapture;
}

export interface ProjectExportResult {
  bundle: ProjectBundle;
  outputDir?: string;
  filesWritten?: string[];
}

export class ProjectExporter {
  private readonly registry: ProjectRegistry;
  private readonly roster: AgentRosterRepository;
  private readonly agentMem: AgentMemory;
  private readonly collective: CollectiveMemory;
  private readonly knowledge: KnowledgeStore;
  private readonly training: TrainingCapture;

  constructor(deps: ProjectExporterDeps) {
    this.registry = deps.projectRegistry;
    this.roster = deps.agentRoster;
    this.agentMem = deps.agentMemory;
    this.collective = deps.collectiveMemory;
    this.knowledge = deps.knowledgeStore;
    this.training = deps.trainingCapture;
  }

  /** Export all project data to an in-memory bundle. */
  exportBundle(projectId: string): ProjectBundle {
    const project = this.registry.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const sessions = this.registry.getSessions(projectId);

    const content = {
      project: {
        name: project.name,
        description: project.description ?? '',
        cwd: project.cwd,
        status: project.status,
      },
      agents: this.exportAgents(projectId),
      knowledge: this.exportKnowledge(projectId),
      collectiveMemory: this.exportCollectiveMemory(projectId),
      agentMemory: this.exportAgentMemory(sessions.map(s => s.leadId)),
      sessions: this.exportSessions(sessions),
      training: this.exportTraining(projectId),
    };

    const manifest = createProjectManifest(content, projectId);

    logger.info({
      module: 'project',
      msg: 'Project exported',
      projectId,
      stats: manifest.stats,
    });

    return { manifest, ...content };
  }

  /** Export to a directory on disk. */
  exportToDirectory(projectId: string, outputPath: string): ProjectExportResult {
    const bundle = this.exportBundle(projectId);
    const bundleDir = outputPath.endsWith(BUNDLE_DIR_SUFFIX)
      ? outputPath
      : join(outputPath, `${projectId}${BUNDLE_DIR_SUFFIX}`);

    const filesWritten: string[] = [];

    mkdirSync(join(bundleDir, 'knowledge'), { recursive: true });
    mkdirSync(join(bundleDir, 'training'), { recursive: true });

    // manifest.json
    const manifestPath = join(bundleDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(bundle.manifest, null, 2), 'utf8');
    filesWritten.push(manifestPath);

    // project.json
    const projectPath = join(bundleDir, 'project.json');
    writeFileSync(projectPath, JSON.stringify(bundle.project, null, 2), 'utf8');
    filesWritten.push(projectPath);

    // agents.json
    if (bundle.agents.length > 0) {
      const agentsPath = join(bundleDir, 'agents.json');
      writeFileSync(agentsPath, JSON.stringify(bundle.agents, null, 2), 'utf8');
      filesWritten.push(agentsPath);
    }

    // knowledge/{category}.json
    for (const category of KNOWLEDGE_CATEGORIES) {
      const entries = bundle.knowledge[category];
      if (entries.length > 0) {
        const knowledgePath = join(bundleDir, 'knowledge', `${category}.json`);
        writeFileSync(knowledgePath, JSON.stringify(entries, null, 2), 'utf8');
        filesWritten.push(knowledgePath);
      }
    }

    // collective-memory.json
    if (bundle.collectiveMemory.length > 0) {
      const memPath = join(bundleDir, 'collective-memory.json');
      writeFileSync(memPath, JSON.stringify(bundle.collectiveMemory, null, 2), 'utf8');
      filesWritten.push(memPath);
    }

    // agent-memory.json
    if (bundle.agentMemory.length > 0) {
      const memPath = join(bundleDir, 'agent-memory.json');
      writeFileSync(memPath, JSON.stringify(bundle.agentMemory, null, 2), 'utf8');
      filesWritten.push(memPath);
    }

    // sessions.json
    if (bundle.sessions.length > 0) {
      const sessionsPath = join(bundleDir, 'sessions.json');
      writeFileSync(sessionsPath, JSON.stringify(bundle.sessions, null, 2), 'utf8');
      filesWritten.push(sessionsPath);
    }

    // training
    if (bundle.training.corrections.length > 0) {
      const correctionsPath = join(bundleDir, 'training', 'corrections.json');
      writeFileSync(correctionsPath, JSON.stringify(bundle.training.corrections, null, 2), 'utf8');
      filesWritten.push(correctionsPath);
    }
    if (bundle.training.feedback.length > 0) {
      const feedbackPath = join(bundleDir, 'training', 'feedback.json');
      writeFileSync(feedbackPath, JSON.stringify(bundle.training.feedback, null, 2), 'utf8');
      filesWritten.push(feedbackPath);
    }

    return { bundle, outputDir: bundleDir, filesWritten };
  }

  // ── Private ─────────────────────────────────────────────────────

  private exportAgents(projectId: string): ProjectAgentExport[] {
    return this.roster.getAllAgents()
      .filter(a => a.projectId === projectId)
      .map(a => ({
        agentId: a.agentId,
        role: a.role,
        model: a.model,
        status: a.status,
        sessionId: a.sessionId ?? undefined,
        teamId: a.teamId,
        lastTaskSummary: a.lastTaskSummary ?? undefined,
        metadata: a.metadata ?? undefined,
        createdAt: a.createdAt,
      }));
  }

  private exportKnowledge(projectId: string): Record<KnowledgeCategory, KnowledgeExport[]> {
    const result: Record<KnowledgeCategory, KnowledgeExport[]> = {
      core: [], procedural: [], semantic: [], episodic: [],
    };
    for (const category of KNOWLEDGE_CATEGORIES) {
      const entries = this.knowledge.getByCategory(projectId, category);
      result[category] = entries.map(e => ({
        key: e.key,
        content: e.content,
        category: e.category as KnowledgeCategory,
        confidence: e.metadata?.confidence as number | undefined,
        tags: e.metadata?.tags as string[] | undefined,
        source: e.metadata?.source as string | undefined,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      }));
    }
    return result;
  }

  private exportCollectiveMemory(projectId: string): CollectiveMemoryExport[] {
    return this.collective.getAll(projectId).map(m => ({
      category: m.category,
      key: m.key,
      value: m.value,
      source: m.source,
      useCount: m.useCount,
    }));
  }

  private exportAgentMemory(leadIds: string[]): AgentMemoryExport[] {
    const result: AgentMemoryExport[] = [];
    for (const leadId of leadIds) {
      const entries = this.agentMem.getByLead(leadId);
      for (const e of entries) {
        result.push({ leadId: e.leadId, agentId: e.agentId, key: e.key, value: e.value });
      }
    }
    return result;
  }

  private exportSessions(sessions: Array<{ leadId: string; sessionId?: string | null; role?: string | null; task?: string | null; status?: string; startedAt?: string; endedAt?: string | null }>): SessionExport[] {
    return sessions.map(s => ({
      leadId: s.leadId,
      sessionId: s.sessionId ?? undefined,
      role: s.role ?? undefined,
      task: s.task ?? undefined,
      status: s.status ?? undefined,
      startedAt: s.startedAt ?? undefined,
      endedAt: s.endedAt ?? undefined,
    }));
  }

  private exportTraining(projectId: string): { corrections: CorrectionExport[]; feedback: FeedbackExport[] } {
    const corrections = this.training.getCorrections(projectId).map(c => ({
      id: c.id,
      agentId: c.agentId,
      originalAction: c.originalAction,
      correctedAction: c.correctedAction,
      context: c.context,
      tags: c.tags,
      timestamp: c.timestamp,
    }));
    const feedback = this.training.getFeedback(projectId).map(f => ({
      id: f.id,
      agentId: f.agentId,
      action: f.action,
      rating: f.rating,
      comment: f.comment,
      tags: f.tags,
      timestamp: f.timestamp,
    }));
    return { corrections, feedback };
  }
}
