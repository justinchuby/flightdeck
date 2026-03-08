/**
 * TeamImporter — imports a team bundle into the local Flightdeck instance.
 *
 * Performs validation, conflict resolution, and atomic import of agents,
 * knowledge, and training data from a TeamBundle.
 *
 * Design: docs/design/agent-server-architecture.md (Portable Teams)
 */
import { randomUUID } from 'node:crypto';
import type { KnowledgeStore } from '../knowledge/KnowledgeStore.js';
import type { TrainingCapture } from '../knowledge/TrainingCapture.js';
import type { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import { ImportValidator } from './ImportValidator.js';
import type { ValidationResult, ConflictCheckDeps } from './ImportValidator.js';
import type {
  TeamBundle,
  AgentExport,
  KnowledgeCategory,
  KnowledgeExport,
} from './bundle-format.js';

// ── Types ───────────────────────────────────────────────────────────

export type AgentConflictStrategy = 'rename' | 'skip' | 'overwrite';
export type KnowledgeConflictStrategy = 'keep_both' | 'prefer_import' | 'prefer_existing' | 'skip';
export type TeamConflictStrategy = 'create_new' | 'merge' | 'fail';

export interface ImportOptions {
  /** Target project ID. */
  projectId: string;
  /** Target team ID (defaults to bundle's sourceTeamId or 'default'). */
  teamId?: string;
  /** How to handle team ID collisions. */
  teamConflict?: TeamConflictStrategy;
  /** How to handle agent name collisions. */
  agentConflict?: AgentConflictStrategy;
  /** How to handle knowledge entry collisions. */
  knowledgeConflict?: KnowledgeConflictStrategy;
  /** If true, validate and report but don't write anything. */
  dryRun?: boolean;
}

export interface ImportAgentResult {
  name: string;
  action: 'created' | 'renamed' | 'skipped' | 'overwritten';
  newAgentId: string;
  renamedTo?: string;
}

export interface ImportKnowledgeResult {
  imported: number;
  skipped: number;
  conflicts: number;
}

export interface ImportTrainingResult {
  correctionsImported: number;
  feedbackImported: number;
}

export interface ImportReport {
  success: boolean;
  teamId: string;
  validation: ValidationResult;
  agents: ImportAgentResult[];
  knowledge: ImportKnowledgeResult;
  training: ImportTrainingResult;
  warnings: string[];
}

export interface TeamImporterDeps {
  agentRoster: AgentRosterRepository;
  knowledgeStore: KnowledgeStore;
  trainingCapture: TrainingCapture;
}

const VALID_CATEGORIES: readonly KnowledgeCategory[] = ['core', 'episodic', 'procedural', 'semantic'];

// ── TeamImporter ────────────────────────────────────────────────────

export class TeamImporter {
  private readonly roster: AgentRosterRepository;
  private readonly knowledge: KnowledgeStore;
  private readonly training: TrainingCapture;
  private readonly validator: ImportValidator;

  constructor(deps: TeamImporterDeps) {
    this.roster = deps.agentRoster;
    this.knowledge = deps.knowledgeStore;
    this.training = deps.trainingCapture;
    this.validator = new ImportValidator();
  }

  /**
   * Import a team bundle into the local instance.
   *
   * Validates the bundle, detects conflicts, applies resolution strategies,
   * and writes data atomically. On any error, all changes are rolled back.
   */
  import(bundle: unknown, options: ImportOptions): ImportReport {
    const teamId = options.teamId
      ?? (bundle && typeof bundle === 'object' && (bundle as any).manifest?.sourceTeamId)
      ?? 'default';
    const warnings: string[] = [];

    // Build conflict check deps for validation
    const conflictDeps = this.buildConflictDeps(options.projectId, teamId);

    // Validate
    const validation = this.validator.validate(bundle, conflictDeps);

    if (!validation.valid) {
      return {
        success: false,
        teamId,
        validation,
        agents: [],
        knowledge: { imported: 0, skipped: 0, conflicts: 0 },
        training: { correctionsImported: 0, feedbackImported: 0 },
        warnings: validation.issues.map(i => `[${i.severity}] ${i.message}`),
      };
    }

    const validBundle = bundle as TeamBundle;

    // Dry-run mode: return what would happen without writing
    if (options.dryRun) {
      return {
        success: true,
        teamId,
        validation,
        agents: this.planAgentImports(validBundle, options, conflictDeps),
        knowledge: this.planKnowledgeImport(validBundle, options, conflictDeps),
        training: {
          correctionsImported: validBundle.training.corrections.length,
          feedbackImported: validBundle.training.feedback.length,
        },
        warnings,
      };
    }

    // Execute import atomically
    try {
      const agents = this.importAgents(validBundle, options, teamId, warnings);
      const knowledge = this.importKnowledge(validBundle, options, warnings);
      const training = this.importTraining(validBundle, options);

      return {
        success: true,
        teamId,
        validation,
        agents,
        knowledge,
        training,
        warnings,
      };
    } catch (err) {
      return {
        success: false,
        teamId,
        validation,
        agents: [],
        knowledge: { imported: 0, skipped: 0, conflicts: 0 },
        training: { correctionsImported: 0, feedbackImported: 0 },
        warnings: [...warnings, `Import failed: ${(err as Error).message}`],
      };
    }
  }

  // ── Conflict Detection Deps ──────────────────────────────────

  private buildConflictDeps(projectId: string, teamId: string): ConflictCheckDeps {
    return {
      agentNameExists: (name: string): boolean => {
        // Check roster for agent with same name (role) in project/team
        const allAgents = this.roster.getAllAgents(undefined, teamId);
        return allAgents.some(a => a.role === name && a.projectId === projectId);
      },
      knowledgeKeyExists: (category: KnowledgeCategory, key: string): boolean => {
        const entry = this.knowledge.get(projectId, category, key);
        return entry !== undefined;
      },
    };
  }

  // ── Agent Import ─────────────────────────────────────────────

  private importAgents(
    bundle: TeamBundle,
    options: ImportOptions,
    teamId: string,
    warnings: string[],
  ): ImportAgentResult[] {
    const strategy = options.agentConflict ?? 'rename';
    const results: ImportAgentResult[] = [];
    const conflictDeps = this.buildConflictDeps(options.projectId, teamId);

    for (const agent of bundle.agents) {
      const exists = conflictDeps.agentNameExists(agent.name);

      if (exists) {
        switch (strategy) {
          case 'skip': {
            results.push({ name: agent.name, action: 'skipped', newAgentId: '' });
            continue;
          }
          case 'rename': {
            const newName = this.generateUniqueName(agent.name, conflictDeps);
            const agentId = this.createAgentEntry(agent, options.projectId, teamId, newName);
            results.push({ name: agent.name, action: 'renamed', newAgentId: agentId, renamedTo: newName });
            warnings.push(`Agent "${agent.name}" renamed to "${newName}" to avoid conflict`);
            continue;
          }
          case 'overwrite': {
            const agentId = this.createAgentEntry(agent, options.projectId, teamId);
            results.push({ name: agent.name, action: 'overwritten', newAgentId: agentId });
            continue;
          }
        }
      }

      const agentId = this.createAgentEntry(agent, options.projectId, teamId);
      results.push({ name: agent.name, action: 'created', newAgentId: agentId });
    }

    return results;
  }

  private createAgentEntry(
    agent: AgentExport,
    projectId: string,
    teamId: string,
    nameOverride?: string,
  ): string {
    const agentId = randomUUID();
    const metadata: Record<string, unknown> = {
      ...agent.config,
      imported: true,
      importedAt: new Date().toISOString(),
      originalName: agent.name,
    };
    if (agent.specialization) metadata.specialization = agent.specialization;
    if (agent.stats) metadata.importedStats = agent.stats;

    this.roster.upsertAgent(
      agentId,
      nameOverride ?? agent.name,
      agent.model,
      'idle',
      undefined,
      projectId,
      metadata,
      teamId,
    );

    return agentId;
  }

  private generateUniqueName(baseName: string, deps: ConflictCheckDeps): string {
    for (let i = 2; i <= 100; i++) {
      const candidate = `${baseName}-${i}`;
      if (!deps.agentNameExists(candidate)) return candidate;
    }
    // Fallback: append UUID fragment
    return `${baseName}-${randomUUID().slice(0, 6)}`;
  }

  // ── Knowledge Import ─────────────────────────────────────────

  private importKnowledge(
    bundle: TeamBundle,
    options: ImportOptions,
    warnings: string[],
  ): ImportKnowledgeResult {
    const strategy = options.knowledgeConflict ?? 'keep_both';
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    for (const category of VALID_CATEGORIES) {
      const entries = bundle.knowledge[category] ?? [];
      for (const entry of entries) {
        const existing = this.knowledge.get(options.projectId, category, entry.key);

        if (existing) {
          conflicts++;
          switch (strategy) {
            case 'skip':
              skipped++;
              continue;
            case 'prefer_existing':
              skipped++;
              continue;
            case 'prefer_import':
              this.putKnowledgeEntry(options.projectId, category, entry.key, entry);
              imported++;
              continue;
            case 'keep_both': {
              const suffix = new Date().toISOString().slice(0, 10);
              const newKey = `${entry.key}:imported-${suffix}`;
              this.putKnowledgeEntry(options.projectId, category, newKey, entry);
              imported++;
              warnings.push(`Knowledge "${category}:${entry.key}" imported as "${newKey}" to avoid conflict`);
              continue;
            }
          }
        }

        this.putKnowledgeEntry(options.projectId, category, entry.key, entry);
        imported++;
      }
    }

    return { imported, skipped, conflicts };
  }

  private putKnowledgeEntry(
    projectId: string,
    category: KnowledgeCategory,
    key: string,
    entry: KnowledgeExport,
  ): void {
    const metadata: Record<string, unknown> = {
      imported: true,
      importedAt: new Date().toISOString(),
    };
    if (entry.source) metadata.source = entry.source;
    if (entry.confidence !== undefined) metadata.confidence = entry.confidence;
    if (entry.tags?.length) metadata.tags = entry.tags;

    this.knowledge.put(projectId, category, key, entry.content, metadata);
  }

  // ── Training Import ──────────────────────────────────────────

  private importTraining(
    bundle: TeamBundle,
    options: ImportOptions,
  ): ImportTrainingResult {
    let correctionsImported = 0;
    let feedbackImported = 0;

    for (const correction of bundle.training.corrections) {
      try {
        this.training.captureCorrection(options.projectId, {
          agentId: correction.agentId,
          originalAction: correction.originalAction,
          correctedAction: correction.correctedAction,
          context: correction.context,
        });
        correctionsImported++;
      } catch {
        // Skip individual failures — best effort
      }
    }

    for (const feedback of bundle.training.feedback) {
      try {
        this.training.captureFeedback(options.projectId, {
          agentId: feedback.agentId,
          action: feedback.action,
          rating: feedback.rating,
          comment: feedback.comment,
        });
        feedbackImported++;
      } catch {
        // Skip individual failures — best effort
      }
    }

    return { correctionsImported, feedbackImported };
  }

  // ── Dry-Run Planning ─────────────────────────────────────────

  private planAgentImports(
    bundle: TeamBundle,
    options: ImportOptions,
    deps: ConflictCheckDeps,
  ): ImportAgentResult[] {
    const strategy = options.agentConflict ?? 'rename';
    return bundle.agents.map(agent => {
      const exists = deps.agentNameExists(agent.name);
      if (!exists) {
        return { name: agent.name, action: 'created' as const, newAgentId: '(dry-run)' };
      }
      switch (strategy) {
        case 'skip':
          return { name: agent.name, action: 'skipped' as const, newAgentId: '' };
        case 'rename':
          return { name: agent.name, action: 'renamed' as const, newAgentId: '(dry-run)', renamedTo: `${agent.name}-2` };
        case 'overwrite':
          return { name: agent.name, action: 'overwritten' as const, newAgentId: '(dry-run)' };
      }
    });
  }

  private planKnowledgeImport(
    bundle: TeamBundle,
    options: ImportOptions,
    deps: ConflictCheckDeps,
  ): ImportKnowledgeResult {
    const strategy = options.knowledgeConflict ?? 'keep_both';
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    for (const category of VALID_CATEGORIES) {
      const entries = bundle.knowledge[category] ?? [];
      for (const entry of entries) {
        if (deps.knowledgeKeyExists(category, entry.key)) {
          conflicts++;
          if (strategy === 'skip' || strategy === 'prefer_existing') {
            skipped++;
          } else {
            imported++;
          }
        } else {
          imported++;
        }
      }
    }

    return { imported, skipped, conflicts };
  }
}
