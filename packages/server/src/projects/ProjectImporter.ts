/**
 * ProjectImporter — imports a ProjectBundle into the local Flightdeck instance.
 *
 * Validates the bundle, creates a new project, and imports all data sections.
 * Idempotent: knowledge/memory use upsert, sessions checked for duplicates.
 * Security: validates bundle structure, enforces 50MB size limit.
 */
import type { KnowledgeStore } from '../knowledge/KnowledgeStore.js';
import type { KnowledgeMetadata } from '../knowledge/types.js';
import type { TrainingCapture } from '../knowledge/TrainingCapture.js';
import type { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import type { CollectiveMemory, MemoryCategory } from '../coordination/knowledge/CollectiveMemory.js';
import type { AgentMemory } from '../agents/AgentMemory.js';
import type { ProjectRegistry } from './ProjectRegistry.js';
import {
  validateProjectManifest,
  verifyProjectChecksum,
  MAX_BUNDLE_SIZE_BYTES,
} from './project-bundle.js';
import type {
  ProjectBundle,
  KnowledgeCategory,
  KnowledgeExport,
} from './project-bundle.js';
import { logger } from '../utils/logger.js';

const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = ['core', 'episodic', 'procedural', 'semantic'];
const MEMORY_CATEGORIES: readonly MemoryCategory[] = ['pattern', 'decision', 'expertise', 'gotcha'];

export interface ProjectImportOptions {
  /** Override the project name from the bundle. */
  name?: string;
  /** Override the CWD from the bundle. */
  cwd?: string;
  /** When true, counts what would be imported without writing. */
  dryRun?: boolean;
  /** Skip checksum verification (not recommended). */
  skipChecksumVerify?: boolean;
}

export interface ImportSectionReport {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ProjectImportReport {
  success: boolean;
  projectId: string | null;
  validation: { valid: boolean; issues: string[] };
  project: { name: string; created: boolean };
  agents: ImportSectionReport;
  knowledge: ImportSectionReport;
  collectiveMemory: ImportSectionReport;
  agentMemory: ImportSectionReport;
  sessions: ImportSectionReport;
  training: ImportSectionReport;
  warnings: string[];
}

export interface ProjectImporterDeps {
  knowledgeStore: KnowledgeStore;
  collectiveMemory: CollectiveMemory;
  agentMemory: AgentMemory;
  agentRoster: AgentRosterRepository;
  projectRegistry: ProjectRegistry;
  trainingCapture: TrainingCapture;
}

export class ProjectImporter {
  private readonly knowledge: KnowledgeStore;
  private readonly collective: CollectiveMemory;
  private readonly agentMem: AgentMemory;
  private readonly roster: AgentRosterRepository;
  private readonly registry: ProjectRegistry;
  private readonly training: TrainingCapture;

  constructor(deps: ProjectImporterDeps) {
    this.knowledge = deps.knowledgeStore;
    this.collective = deps.collectiveMemory;
    this.agentMem = deps.agentMemory;
    this.roster = deps.agentRoster;
    this.registry = deps.projectRegistry;
    this.training = deps.trainingCapture;
  }

  /** Import a project from a ProjectBundle. */
  import(bundle: unknown, options: ProjectImportOptions = {}): ProjectImportReport {
    const report = this.emptyReport();

    // ── Validate ──────────────────────────────────────
    const validation = this.validate(bundle, options);
    report.validation = validation;
    if (!validation.valid) {
      report.success = false;
      report.warnings = validation.issues;
      return report;
    }

    const b = bundle as ProjectBundle;
    const projectName = options.name || b.project.name;
    report.project.name = projectName;

    // ── Dry run ───────────────────────────────────────
    if (options.dryRun) {
      return this.dryRunReport(b, projectName);
    }

    // ── Create project ────────────────────────────────
    let project;
    try {
      project = this.registry.create(
        projectName,
        b.project.description,
        options.cwd || b.project.cwd || undefined,
      );
      report.projectId = project.id;
      report.project.created = true;
    } catch (err) {
      report.success = false;
      report.warnings.push(`Failed to create project: ${String(err)}`);
      return report;
    }

    // ── Import sections ───────────────────────────────
    this.importKnowledge(b, project.id, report);
    this.importCollectiveMemory(b, project.id, report);
    this.importAgentMemory(b, report);
    this.importAgents(b, project.id, report);
    this.importSessions(b, project.id, report);
    this.importTraining(b, project.id, report);

    logger.info({
      module: 'project',
      msg: 'Project imported',
      projectId: project.id,
      projectName,
      knowledge: report.knowledge.imported,
      memory: report.collectiveMemory.imported,
      agents: report.agents.imported,
      sessions: report.sessions.imported,
    });

    return report;
  }

  // ── Validation ──────────────────────────────────────

  private validate(bundle: unknown, options: ProjectImportOptions): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!bundle || typeof bundle !== 'object') {
      issues.push('Bundle must be a non-null object');
      return { valid: false, issues };
    }

    const b = bundle as Record<string, unknown>;

    // Check manifest
    if (!validateProjectManifest(b.manifest)) {
      issues.push('Invalid or missing manifest');
      return { valid: false, issues };
    }

    // Size check (approximate)
    const sizeEstimate = JSON.stringify(bundle).length;
    if (sizeEstimate > MAX_BUNDLE_SIZE_BYTES) {
      issues.push(`Bundle too large: ${(sizeEstimate / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_BUNDLE_SIZE_BYTES / 1024 / 1024}MB limit`);
      return { valid: false, issues };
    }

    // Check required sections
    if (!b.project || typeof b.project !== 'object') {
      issues.push('Missing project metadata');
    }
    if (!b.knowledge || typeof b.knowledge !== 'object') {
      issues.push('Missing knowledge section');
    }

    if (issues.length > 0) return { valid: false, issues };

    // Checksum verification
    if (!options.skipChecksumVerify) {
      if (!verifyProjectChecksum(bundle as ProjectBundle)) {
        issues.push('Checksum verification failed — bundle may be corrupted');
        return { valid: false, issues };
      }
    }

    return { valid: true, issues: [] };
  }

  // ── Knowledge ───────────────────────────────────────

  private importKnowledge(bundle: ProjectBundle, projectId: string, report: ProjectImportReport): void {
    for (const category of KNOWLEDGE_CATEGORIES) {
      const entries = bundle.knowledge[category] ?? [];
      for (const entry of entries) {
        if (!entry.key || !entry.content) {
          report.knowledge.skipped++;
          report.knowledge.errors.push(`${category}: invalid entry (missing key or content)`);
          continue;
        }
        try {
          const metadata: KnowledgeMetadata = {
            ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
            ...(entry.tags ? { tags: entry.tags } : {}),
            ...(entry.source ? { source: entry.source } : {}),
            imported: true,
          };
          this.knowledge.put(projectId, category, entry.key, entry.content, metadata);
          report.knowledge.imported++;
        } catch (err) {
          report.knowledge.errors.push(`${category}/${entry.key}: ${String(err)}`);
        }
      }
    }
  }

  // ── Collective Memory ───────────────────────────────

  private importCollectiveMemory(bundle: ProjectBundle, projectId: string, report: ProjectImportReport): void {
    for (const mem of bundle.collectiveMemory ?? []) {
      if (!mem.key || !mem.value || !mem.category) {
        report.collectiveMemory.skipped++;
        report.collectiveMemory.errors.push('Invalid memory entry (missing key, value, or category)');
        continue;
      }
      if (!MEMORY_CATEGORIES.includes(mem.category as MemoryCategory)) {
        report.collectiveMemory.skipped++;
        report.collectiveMemory.errors.push(`Unknown memory category: ${mem.category}`);
        continue;
      }
      try {
        this.collective.remember(
          mem.category as MemoryCategory,
          mem.key,
          mem.value,
          mem.source || 'import',
          projectId,
        );
        report.collectiveMemory.imported++;
      } catch (err) {
        report.collectiveMemory.errors.push(`${mem.category}/${mem.key}: ${String(err)}`);
      }
    }
  }

  // ── Agent Memory ────────────────────────────────────

  private importAgentMemory(bundle: ProjectBundle, report: ProjectImportReport): void {
    for (const mem of bundle.agentMemory ?? []) {
      if (!mem.leadId || !mem.agentId || !mem.key) {
        report.agentMemory.skipped++;
        report.agentMemory.errors.push('Invalid agent memory entry (missing leadId, agentId, or key)');
        continue;
      }
      try {
        this.agentMem.store(mem.leadId, mem.agentId, mem.key, mem.value);
        report.agentMemory.imported++;
      } catch (err) {
        report.agentMemory.errors.push(`${mem.agentId}/${mem.key}: ${String(err)}`);
      }
    }
  }

  // ── Agents ──────────────────────────────────────────

  private importAgents(bundle: ProjectBundle, projectId: string, report: ProjectImportReport): void {
    for (const agent of bundle.agents ?? []) {
      if (!agent.agentId || !agent.role || !agent.model) {
        report.agents.skipped++;
        report.agents.errors.push('Invalid agent entry (missing agentId, role, or model)');
        continue;
      }
      try {
        this.roster.upsertAgent(
          agent.agentId,
          agent.role,
          agent.model,
          'terminated',        // Imported agents start as terminated
          agent.sessionId,
          projectId,           // Remap to new project
          { ...(agent.metadata ?? {}), imported: true },
          agent.teamId || 'default',
        );
        report.agents.imported++;
      } catch (err) {
        report.agents.errors.push(`${agent.agentId}: ${String(err)}`);
      }
    }
  }

  // ── Sessions ────────────────────────────────────────

  private importSessions(bundle: ProjectBundle, projectId: string, report: ProjectImportReport): void {
    // Load existing to avoid duplicates
    let existingSessions: Array<{ leadId: string; task?: string | null }> = [];
    try {
      existingSessions = this.registry.getSessions(projectId);
    } catch {
      // Proceed without duplicate detection
    }

    for (const session of bundle.sessions ?? []) {
      if (!session.leadId) {
        report.sessions.skipped++;
        report.sessions.errors.push('Invalid session (missing leadId)');
        continue;
      }

      const isDuplicate = existingSessions.some(
        s => s.leadId === session.leadId && (s.task ?? null) === (session.task ?? null),
      );
      if (isDuplicate) {
        report.sessions.skipped++;
        continue;
      }

      try {
        this.registry.startSession(projectId, session.leadId, session.task, session.role);
        report.sessions.imported++;
      } catch (err) {
        report.sessions.errors.push(`session/${session.leadId}: ${String(err)}`);
      }
    }
  }

  // ── Training ────────────────────────────────────────

  private importTraining(bundle: ProjectBundle, projectId: string, report: ProjectImportReport): void {
    for (const c of bundle.training?.corrections ?? []) {
      try {
        this.training.captureCorrection(projectId, {
          agentId: c.agentId,
          originalAction: c.originalAction,
          correctedAction: c.correctedAction,
          context: c.context,
          tags: c.tags,
        });
        report.training.imported++;
      } catch (err) {
        report.training.errors.push(`correction/${c.id}: ${String(err)}`);
      }
    }
    for (const f of bundle.training?.feedback ?? []) {
      try {
        this.training.captureFeedback(projectId, {
          agentId: f.agentId,
          action: f.action,
          rating: f.rating,
          comment: f.comment,
          tags: f.tags,
        });
        report.training.imported++;
      } catch (err) {
        report.training.errors.push(`feedback/${f.id}: ${String(err)}`);
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────

  private emptyReport(): ProjectImportReport {
    return {
      success: true,
      projectId: null,
      validation: { valid: true, issues: [] },
      project: { name: '', created: false },
      agents: { imported: 0, skipped: 0, errors: [] },
      knowledge: { imported: 0, skipped: 0, errors: [] },
      collectiveMemory: { imported: 0, skipped: 0, errors: [] },
      agentMemory: { imported: 0, skipped: 0, errors: [] },
      sessions: { imported: 0, skipped: 0, errors: [] },
      training: { imported: 0, skipped: 0, errors: [] },
      warnings: [],
    };
  }

  private dryRunReport(bundle: ProjectBundle, projectName: string): ProjectImportReport {
    const knowledgeCount = Object.values(bundle.knowledge ?? {}).reduce(
      (sum: number, entries: KnowledgeExport[]) => sum + entries.length, 0,
    );
    return {
      success: true,
      projectId: null,
      validation: { valid: true, issues: [] },
      project: { name: projectName, created: false },
      agents: { imported: bundle.agents?.length ?? 0, skipped: 0, errors: [] },
      knowledge: { imported: knowledgeCount, skipped: 0, errors: [] },
      collectiveMemory: { imported: bundle.collectiveMemory?.length ?? 0, skipped: 0, errors: [] },
      agentMemory: { imported: bundle.agentMemory?.length ?? 0, skipped: 0, errors: [] },
      sessions: { imported: bundle.sessions?.length ?? 0, skipped: 0, errors: [] },
      training: {
        imported: (bundle.training?.corrections?.length ?? 0) + (bundle.training?.feedback?.length ?? 0),
        skipped: 0,
        errors: [],
      },
      warnings: ['Dry run — no data was written'],
    };
  }
}
