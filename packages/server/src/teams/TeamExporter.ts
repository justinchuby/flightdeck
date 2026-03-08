/**
 * TeamExporter — exports a team's agents, knowledge, and training to a bundle.
 *
 * Queries existing stores (AgentRosterRepository, KnowledgeStore, TrainingCapture)
 * and produces a TeamBundle or writes it to a directory.
 *
 * Design: docs/design/agent-server-architecture.md (Portable Teams)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeStore } from '../knowledge/KnowledgeStore.js';
import type { TrainingCapture } from '../knowledge/TrainingCapture.js';
import type { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import {
  computeChecksum,
  createManifest,
  BUNDLE_FORMAT_VERSION,
} from './bundle-format.js';
import type {
  TeamBundle,
  AgentExport,
  KnowledgeExport,
  KnowledgeCategory,
  CorrectionExport,
  FeedbackExport,
  ExportOptions,
  BundleManifest,
} from './bundle-format.js';

// ── Types ───────────────────────────────────────────────────────────

export interface TeamExporterDeps {
  agentRoster: AgentRosterRepository;
  knowledgeStore: KnowledgeStore;
  trainingCapture: TrainingCapture;
}

export interface ExportResult {
  bundle: TeamBundle;
  outputDir?: string;
  filesWritten?: string[];
}

// ── Constants ───────────────────────────────────────────────────────

const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['core', 'procedural', 'semantic', 'episodic'];
const BUNDLE_DIR_SUFFIX = '.flightdeck-team';

// ── TeamExporter ────────────────────────────────────────────────────

export class TeamExporter {
  private readonly roster: AgentRosterRepository;
  private readonly knowledge: KnowledgeStore;
  private readonly training: TrainingCapture;

  constructor(deps: TeamExporterDeps) {
    this.roster = deps.agentRoster;
    this.knowledge = deps.knowledgeStore;
    this.training = deps.trainingCapture;
  }

  /**
   * Export a team to an in-memory bundle.
   * Scoped by projectId — exports all agents and knowledge for that project.
   * If teamId is available on agents, filters by project match.
   */
  exportBundle(projectId: string, options?: ExportOptions): TeamBundle {
    const agents = this.exportAgents(projectId, options?.agentIds);
    const knowledge = this.exportKnowledge(projectId, options);
    const training = this.exportTraining(projectId, options);

    const content = { agents, knowledge, training };
    const manifest = createManifest(content, { projectId });

    return { manifest, ...content };
  }

  /**
   * Export a team to a directory on disk.
   * Creates the bundle directory structure with JSON files.
   */
  exportToDirectory(projectId: string, outputPath: string, options?: ExportOptions): ExportResult {
    const bundle = this.exportBundle(projectId, options);
    const bundleDir = outputPath.endsWith(BUNDLE_DIR_SUFFIX)
      ? outputPath
      : join(outputPath, `${projectId}${BUNDLE_DIR_SUFFIX}`);

    const filesWritten: string[] = [];

    // Create directory structure
    mkdirSync(join(bundleDir, 'agents'), { recursive: true });
    mkdirSync(join(bundleDir, 'knowledge'), { recursive: true });
    mkdirSync(join(bundleDir, 'training'), { recursive: true });

    // Write manifest
    const manifestPath = join(bundleDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(bundle.manifest, null, 2), 'utf8');
    filesWritten.push(manifestPath);

    // Write agents
    for (const agent of bundle.agents) {
      const safeName = agent.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      const agentPath = join(bundleDir, 'agents', `${safeName}.json`);
      writeFileSync(agentPath, JSON.stringify(agent, null, 2), 'utf8');
      filesWritten.push(agentPath);
    }

    // Write knowledge by category
    for (const category of KNOWLEDGE_CATEGORIES) {
      const entries = bundle.knowledge[category];
      if (entries.length > 0) {
        const knowledgePath = join(bundleDir, 'knowledge', `${category}.json`);
        writeFileSync(knowledgePath, JSON.stringify(entries, null, 2), 'utf8');
        filesWritten.push(knowledgePath);
      }
    }

    // Write training
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

  // ── Private: Export Agents ──────────────────────────────────────

  private exportAgents(projectId: string, agentIds?: string[]): AgentExport[] {
    let agents = this.roster.getAllAgents();

    // Filter by projectId if agents have it
    agents = agents.filter((a) => !a.projectId || a.projectId === projectId);

    // Filter by specific agent IDs if requested
    if (agentIds && agentIds.length > 0) {
      const idSet = new Set(agentIds);
      agents = agents.filter((a) => idSet.has(a.agentId));
    }

    return agents.map((a) => ({
      name: a.agentId,
      role: a.role,
      model: a.model,
      status: a.status,
      sessionId: a.sessionId ?? undefined,
      config: a.metadata ?? {},
      stats: {
        createdAt: a.createdAt,
        lastTaskSummary: a.lastTaskSummary ?? undefined,
      },
    }));
  }

  // ── Private: Export Knowledge ──────────────────────────────────

  private exportKnowledge(
    projectId: string,
    options?: ExportOptions,
  ): Record<KnowledgeCategory, KnowledgeExport[]> {
    const result: Record<KnowledgeCategory, KnowledgeExport[]> = {
      core: [],
      procedural: [],
      semantic: [],
      episodic: [],
    };

    if (options?.includeKnowledge === false) return result;

    const categories = options?.categories ?? KNOWLEDGE_CATEGORIES;
    const activeCategories = options?.excludeEpisodic
      ? categories.filter((c) => c !== 'episodic')
      : categories;

    for (const category of activeCategories) {
      const entries = this.knowledge.getByCategory(projectId, category);
      result[category] = entries.map((e) => ({
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

  // ── Private: Export Training ───────────────────────────────────

  private exportTraining(
    projectId: string,
    options?: ExportOptions,
  ): { corrections: CorrectionExport[]; feedback: FeedbackExport[] } {
    if (options?.includeTraining === false) {
      return { corrections: [], feedback: [] };
    }

    const corrections = this.training.getCorrections(projectId).map((c) => ({
      id: c.id,
      agentId: c.agentId,
      originalAction: c.originalAction,
      correctedAction: c.correctedAction,
      context: c.context,
      tags: c.tags,
      timestamp: c.timestamp,
    }));

    const feedback = this.training.getFeedback(projectId).map((f) => ({
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
