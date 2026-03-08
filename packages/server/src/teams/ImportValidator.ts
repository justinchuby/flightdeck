/**
 * ImportValidator — 5-phase validation for team bundle imports.
 *
 * Phases:
 *  1. Format check: Valid TeamBundle structure with manifest.json
 *  2. Version check: Bundle format version compatible with this Flightdeck
 *  3. Integrity check: SHA-256 checksum matches
 *  4. Conflict detection: Agent names / knowledge keys collide with existing data
 *  5. Dry-run: Simulate import and report what would change
 *
 * Design: docs/design/agent-server-architecture.md (Portable Teams)
 */
import {
  BUNDLE_FORMAT_VERSION,
  validateManifest,
  verifyChecksum,
} from './bundle-format.js';
import type {
  TeamBundle,
  KnowledgeCategory,
  KnowledgeExport,
  AgentExport,
} from './bundle-format.js';

// ── Types ───────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  phase: 'format' | 'version' | 'integrity' | 'conflict' | 'size';
  severity: ValidationSeverity;
  message: string;
  field?: string;
}

export interface ConflictInfo {
  type: 'agent' | 'knowledge';
  key: string;
  details: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  conflicts: ConflictInfo[];
  /** Summary of what the import would do (populated during dry-run). */
  dryRun?: DryRunSummary;
}

export interface DryRunSummary {
  agentsToCreate: number;
  agentsToSkip: number;
  agentsToRename: number;
  knowledgeToImport: number;
  knowledgeToSkip: number;
  knowledgeConflicts: number;
  correctionsToImport: number;
  feedbackToImport: number;
}

export interface ConflictCheckDeps {
  /** Check if an agent with the given name exists in the target project/team. */
  agentNameExists: (name: string) => boolean;
  /** Check if a knowledge entry with (category, key) exists in the target project. */
  knowledgeKeyExists: (category: KnowledgeCategory, key: string) => boolean;
}

/** Maximum bundle size in bytes (50 MB). */
const MAX_BUNDLE_SIZE_BYTES = 50 * 1024 * 1024;
/** Maximum number of agents per bundle. */
const MAX_AGENTS = 100;
/** Maximum number of knowledge entries per bundle. */
const MAX_KNOWLEDGE_ENTRIES = 5000;

const VALID_CATEGORIES: readonly KnowledgeCategory[] = ['core', 'episodic', 'procedural', 'semantic'];

// ── ImportValidator ─────────────────────────────────────────────────

export class ImportValidator {
  /**
   * Run all 5 validation phases on a bundle.
   *
   * @param bundle - The team bundle to validate
   * @param conflictDeps - Optional dependency injection for conflict checking.
   *   If omitted, phase 4 (conflict detection) is skipped.
   * @returns Validation result with issues, conflicts, and optional dry-run summary
   */
  validate(bundle: unknown, conflictDeps?: ConflictCheckDeps): ValidationResult {
    const issues: ValidationIssue[] = [];
    const conflicts: ConflictInfo[] = [];

    // Phase 1: Format check
    if (!this.validateFormat(bundle, issues)) {
      return { valid: false, issues, conflicts };
    }
    const validBundle = bundle as TeamBundle;

    // Phase 2: Version check
    this.validateVersion(validBundle, issues);

    // Phase 3: Integrity check
    this.validateIntegrity(validBundle, issues);

    // Phase 4: Size limits
    this.validateSize(validBundle, issues);

    // Bail if hard errors found before conflict detection
    if (issues.some(i => i.severity === 'error')) {
      return { valid: false, issues, conflicts };
    }

    // Phase 5: Conflict detection (requires deps)
    if (conflictDeps) {
      this.detectConflicts(validBundle, conflictDeps, conflicts, issues);
    }

    const hasErrors = issues.some(i => i.severity === 'error');

    // Dry-run summary
    const dryRun = this.buildDryRunSummary(validBundle, conflicts);

    return { valid: !hasErrors, issues, conflicts, dryRun };
  }

  // ── Phase 1: Format ──────────────────────────────────────────

  private validateFormat(bundle: unknown, issues: ValidationIssue[]): boolean {
    if (!bundle || typeof bundle !== 'object') {
      issues.push({ phase: 'format', severity: 'error', message: 'Bundle must be a non-null object' });
      return false;
    }

    const b = bundle as Record<string, unknown>;

    // Check manifest
    if (!b.manifest) {
      issues.push({ phase: 'format', severity: 'error', message: 'Missing manifest', field: 'manifest' });
      return false;
    }
    if (!validateManifest(b.manifest)) {
      issues.push({ phase: 'format', severity: 'error', message: 'Invalid manifest structure', field: 'manifest' });
      return false;
    }

    // Check agents array
    if (!Array.isArray(b.agents)) {
      issues.push({ phase: 'format', severity: 'error', message: 'Missing or invalid agents array', field: 'agents' });
      return false;
    }
    for (let i = 0; i < (b.agents as unknown[]).length; i++) {
      this.validateAgentExport((b.agents as unknown[])[i], i, issues);
    }

    // Check knowledge record
    if (!b.knowledge || typeof b.knowledge !== 'object') {
      issues.push({ phase: 'format', severity: 'error', message: 'Missing or invalid knowledge object', field: 'knowledge' });
      return false;
    }
    this.validateKnowledgeExport(b.knowledge as Record<string, unknown>, issues);

    // Check training
    if (!b.training || typeof b.training !== 'object') {
      issues.push({ phase: 'format', severity: 'error', message: 'Missing or invalid training object', field: 'training' });
      return false;
    }
    const training = b.training as Record<string, unknown>;
    if (!Array.isArray(training.corrections)) {
      issues.push({ phase: 'format', severity: 'error', message: 'Missing or invalid training.corrections', field: 'training.corrections' });
    }
    if (!Array.isArray(training.feedback)) {
      issues.push({ phase: 'format', severity: 'error', message: 'Missing or invalid training.feedback', field: 'training.feedback' });
    }

    return !issues.some(i => i.severity === 'error');
  }

  private validateAgentExport(agent: unknown, index: number, issues: ValidationIssue[]): void {
    if (!agent || typeof agent !== 'object') {
      issues.push({ phase: 'format', severity: 'error', message: `agents[${index}] must be an object`, field: `agents[${index}]` });
      return;
    }
    const a = agent as Record<string, unknown>;
    if (typeof a.name !== 'string' || !a.name) {
      issues.push({ phase: 'format', severity: 'error', message: `agents[${index}].name is required`, field: `agents[${index}].name` });
    }
    if (typeof a.role !== 'string' || !a.role) {
      issues.push({ phase: 'format', severity: 'error', message: `agents[${index}].role is required`, field: `agents[${index}].role` });
    }
    if (typeof a.model !== 'string' || !a.model) {
      issues.push({ phase: 'format', severity: 'error', message: `agents[${index}].model is required`, field: `agents[${index}].model` });
    }
  }

  private validateKnowledgeExport(knowledge: Record<string, unknown>, issues: ValidationIssue[]): void {
    for (const category of VALID_CATEGORIES) {
      const entries = knowledge[category];
      if (entries === undefined) continue; // Optional category
      if (!Array.isArray(entries)) {
        issues.push({ phase: 'format', severity: 'error', message: `knowledge.${category} must be an array`, field: `knowledge.${category}` });
        continue;
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Record<string, unknown> | undefined;
        if (!entry || typeof entry !== 'object') {
          issues.push({ phase: 'format', severity: 'error', message: `knowledge.${category}[${i}] must be an object`, field: `knowledge.${category}[${i}]` });
          continue;
        }
        if (typeof entry.key !== 'string' || !entry.key) {
          issues.push({ phase: 'format', severity: 'error', message: `knowledge.${category}[${i}].key is required`, field: `knowledge.${category}[${i}].key` });
        }
        if (typeof entry.content !== 'string') {
          issues.push({ phase: 'format', severity: 'error', message: `knowledge.${category}[${i}].content is required`, field: `knowledge.${category}[${i}].content` });
        }
      }
    }
  }

  // ── Phase 2: Version ─────────────────────────────────────────

  private validateVersion(bundle: TeamBundle, issues: ValidationIssue[]): void {
    if (bundle.manifest.bundleFormat !== BUNDLE_FORMAT_VERSION) {
      issues.push({
        phase: 'version',
        severity: 'error',
        message: `Unsupported bundle format version: ${bundle.manifest.bundleFormat} (expected ${BUNDLE_FORMAT_VERSION})`,
        field: 'manifest.bundleFormat',
      });
    }
  }

  // ── Phase 3: Integrity ───────────────────────────────────────

  private validateIntegrity(bundle: TeamBundle, issues: ValidationIssue[]): void {
    if (!verifyChecksum(bundle)) {
      issues.push({
        phase: 'integrity',
        severity: 'error',
        message: 'Checksum mismatch — bundle content has been tampered with or is corrupt',
        field: 'manifest.checksum',
      });
    }
  }

  // ── Phase 4: Size limits ─────────────────────────────────────

  private validateSize(bundle: TeamBundle, issues: ValidationIssue[]): void {
    // Estimate bundle size via JSON serialization
    const estimatedSize = Buffer.byteLength(JSON.stringify(bundle), 'utf-8');
    if (estimatedSize > MAX_BUNDLE_SIZE_BYTES) {
      issues.push({
        phase: 'size',
        severity: 'error',
        message: `Bundle exceeds maximum size: ${(estimatedSize / (1024 * 1024)).toFixed(1)}MB > 50MB`,
      });
    }

    if (bundle.agents.length > MAX_AGENTS) {
      issues.push({
        phase: 'size',
        severity: 'warning',
        message: `Bundle contains ${bundle.agents.length} agents (recommended max: ${MAX_AGENTS})`,
      });
    }

    const knowledgeCount = Object.values(bundle.knowledge).reduce((sum, arr) => sum + arr.length, 0);
    if (knowledgeCount > MAX_KNOWLEDGE_ENTRIES) {
      issues.push({
        phase: 'size',
        severity: 'warning',
        message: `Bundle contains ${knowledgeCount} knowledge entries (recommended max: ${MAX_KNOWLEDGE_ENTRIES})`,
      });
    }
  }

  // ── Phase 5: Conflict Detection ──────────────────────────────

  private detectConflicts(
    bundle: TeamBundle,
    deps: ConflictCheckDeps,
    conflicts: ConflictInfo[],
    issues: ValidationIssue[],
  ): void {
    // Agent name conflicts
    for (const agent of bundle.agents) {
      if (deps.agentNameExists(agent.name)) {
        conflicts.push({
          type: 'agent',
          key: agent.name,
          details: `Agent "${agent.name}" already exists in target`,
        });
      }
    }

    // Knowledge key conflicts
    for (const category of VALID_CATEGORIES) {
      const entries = bundle.knowledge[category] ?? [];
      for (const entry of entries) {
        if (deps.knowledgeKeyExists(category, entry.key)) {
          conflicts.push({
            type: 'knowledge',
            key: `${category}:${entry.key}`,
            details: `Knowledge entry "${entry.key}" in "${category}" already exists`,
          });
        }
      }
    }

    if (conflicts.length > 0) {
      issues.push({
        phase: 'conflict',
        severity: 'warning',
        message: `${conflicts.length} conflict(s) detected — use conflict resolution options to handle`,
      });
    }
  }

  // ── Dry-Run Summary ──────────────────────────────────────────

  private buildDryRunSummary(bundle: TeamBundle, conflicts: ConflictInfo[]): DryRunSummary {
    const agentConflicts = conflicts.filter(c => c.type === 'agent');
    const knowledgeConflicts = conflicts.filter(c => c.type === 'knowledge');

    const knowledgeCount = Object.values(bundle.knowledge).reduce((sum, arr) => sum + arr.length, 0);

    return {
      agentsToCreate: bundle.agents.length - agentConflicts.length,
      agentsToSkip: 0, // Depends on resolution strategy — reported by importer
      agentsToRename: agentConflicts.length,
      knowledgeToImport: knowledgeCount - knowledgeConflicts.length,
      knowledgeToSkip: 0,
      knowledgeConflicts: knowledgeConflicts.length,
      correctionsToImport: bundle.training.corrections.length,
      feedbackToImport: bundle.training.feedback.length,
    };
  }
}
