import type { Database } from '../../db/database.js';
import type { ConfigStore } from '../../config/ConfigStore.js';
import { logger } from '../../utils/logger.js';
import * as path from 'node:path';

// ── Constants ─────────────────────────────────────────────────────

const SETTINGS_KEY_CONFLICTS = 'conflicts';
const SETTINGS_KEY_CONFIG = 'conflict_config';
const MAX_CONFLICTS = 200;
/** Resolved/dismissed conflicts older than 1 hour are pruned on save. */
const PRUNE_AGE_MS = 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────

export type ConflictType =
  | 'same_directory'
  | 'import_overlap'
  | 'lock_contention'
  | 'branch_divergence';

export interface ConflictAgent {
  agentId: string;
  role: string;
  files: string[];
  taskId: string | null;
}

export interface ConflictFile {
  path: string;
  agents: string[];
  editType: 'locked' | 'recently_edited' | 'import_dependency';
  risk: 'direct' | 'indirect';
}

export type ConflictResolution =
  | { type: 'sequenced'; order: [string, string] }
  | { type: 'merged'; by: string }
  | { type: 'dismissed'; by: 'user' | 'system' }
  | { type: 'auto_resolved'; method: string };

export interface ConflictAlert {
  id: string;
  type: ConflictType;
  severity: 'low' | 'medium' | 'high';
  agents: [ConflictAgent, ConflictAgent];
  files: ConflictFile[];
  description: string;
  detectedAt: string;
  resolution?: ConflictResolution;
  status: 'active' | 'resolved' | 'dismissed';
}

export interface ConflictDetectionConfig {
  enabled: boolean;
  checkIntervalMs: number;
  directoryOverlapEnabled: boolean;
  importAnalysisEnabled: boolean;
  branchDivergenceEnabled: boolean;
}

export interface FileLockInfo {
  filePath: string;
  agentId: string;
  role?: string;
  taskId?: string | null;
}

export interface RecentEdit {
  filePath: string;
  agentId: string;
  role?: string;
  timestamp: string;
}

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: ConflictDetectionConfig = {
  enabled: true,
  checkIntervalMs: 15000,
  directoryOverlapEnabled: true,
  importAnalysisEnabled: true,
  branchDivergenceEnabled: true,
};

// ── Helpers ───────────────────────────────────────────────────────

function generateConflictId(): string {
  return `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Simple glob matcher supporting `*` (anything except `/`) and `**` (anything including `/`).
 * Only supports trailing glob patterns like `dir/*` or `dir/**`.
 */
export function simpleGlobMatch(pattern: string, filePath: string): boolean {
  if (pattern === filePath) return true;

  // Handle ** — matches across directory separators
  if (pattern.includes('**')) {
    const prefix = pattern.split('**')[0];
    return filePath.startsWith(prefix);
  }

  // Handle trailing * — matches within a single directory
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1); // keep the trailing slash
    // File must start with prefix and have no further slashes
    if (!filePath.startsWith(prefix)) return false;
    const rest = filePath.slice(prefix.length);
    return !rest.includes('/');
  }

  // Handle * in the middle (e.g., src/*.ts)
  if (pattern.includes('*')) {
    const parts = pattern.split('*');
    if (parts.length === 2) {
      return filePath.startsWith(parts[0]) && filePath.endsWith(parts[1]) && !filePath.slice(parts[0].length, filePath.length - parts[1].length).includes('/');
    }
  }

  return false;
}

// ── Engine ────────────────────────────────────────────────────────

export class ConflictDetectionEngine {
  private conflicts: Map<string, ConflictAlert> = new Map();
  private config: ConflictDetectionConfig;

  constructor(private db: Database, private configStore?: ConfigStore) {
    this.config = this.loadConfig();
    const saved = this.loadConflicts();
    for (const c of saved) this.conflicts.set(c.id, c);
  }

  // ── Core API ──────────────────────────────────────────────────

  /** Return only active conflicts. */
  getConflicts(): ConflictAlert[] {
    return [...this.conflicts.values()].filter(c => c.status === 'active');
  }

  /** Return all conflicts including resolved and dismissed. */
  getAllConflicts(): ConflictAlert[] {
    return [...this.conflicts.values()];
  }

  /** Get a single conflict by ID. */
  getConflict(id: string): ConflictAlert | undefined {
    return this.conflicts.get(id);
  }

  /** Get current config. */
  getConfig(): ConflictDetectionConfig {
    return { ...this.config };
  }

  /** Update config with partial values. */
  updateConfig(updates: Partial<ConflictDetectionConfig>): ConflictDetectionConfig {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
    return { ...this.config };
  }

  // ── Resolution ────────────────────────────────────────────────

  /** Resolve a conflict with a specific resolution strategy. */
  resolve(id: string, resolution: ConflictResolution): boolean {
    const conflict = this.conflicts.get(id);
    if (!conflict || conflict.status !== 'active') return false;
    conflict.resolution = resolution;
    conflict.status = 'resolved';
    this.saveConflicts();
    logger.info({ module: 'coordination', msg: 'Conflict resolved', conflictId: id, resolutionType: resolution.type });
    return true;
  }

  /** Dismiss a conflict. */
  dismiss(id: string): boolean {
    const conflict = this.conflicts.get(id);
    if (!conflict || conflict.status !== 'active') return false;
    conflict.resolution = { type: 'dismissed', by: 'user' };
    conflict.status = 'dismissed';
    this.saveConflicts();
    logger.info({ module: 'coordination', msg: 'Conflict dismissed', conflictId: id });
    return true;
  }

  // ── Detection ─────────────────────────────────────────────────

  /**
   * Run all enabled detectors and return newly created conflicts.
   * Called periodically or manually.
   */
  scan(locks: FileLockInfo[], recentEdits: RecentEdit[]): ConflictAlert[] {
    if (!this.config.enabled) return [];

    const detected: ConflictAlert[] = [];

    if (this.config.directoryOverlapEnabled) {
      detected.push(...this.detectDirectoryOverlap(locks));
    }

    if (this.config.importAnalysisEnabled) {
      detected.push(...this.detectImportOverlap(locks, recentEdits));
    }

    // Lock contention is always checked (it's the most critical)
    detected.push(...this.detectLockContention(locks));

    // Branch divergence is NOT implemented in V1
    // Will be added when GitHub integration is connected

    const newConflicts = this.mergeConflicts(detected);
    if (newConflicts.length > 0) {
      this.saveConflicts();
      logger.info({ module: 'coordination', msg: 'Scan found new conflicts', count: newConflicts.length });
    }

    return newConflicts;
  }

  // ── Private: Detection Algorithms ─────────────────────────────

  /**
   * Detect agents working in the same directory.
   * Groups locks by directory and creates conflicts for dirs with 2+ agents.
   */
  private detectDirectoryOverlap(locks: FileLockInfo[]): ConflictAlert[] {
    const alerts: ConflictAlert[] = [];

    // Group locks by directory
    const dirMap = new Map<string, FileLockInfo[]>();
    for (const lock of locks) {
      const dir = path.dirname(lock.filePath);
      const existing = dirMap.get(dir) ?? [];
      existing.push(lock);
      dirMap.set(dir, existing);
    }

    // For each directory with 2+ unique agents, create a conflict
    for (const [dir, dirLocks] of dirMap) {
      const agentGroups = new Map<string, FileLockInfo[]>();
      for (const lock of dirLocks) {
        const group = agentGroups.get(lock.agentId) ?? [];
        group.push(lock);
        agentGroups.set(lock.agentId, group);
      }

      if (agentGroups.size < 2) continue;

      // Create pairwise conflicts between agents in same directory
      const agentIds = [...agentGroups.keys()];
      for (let i = 0; i < agentIds.length; i++) {
        for (let j = i + 1; j < agentIds.length; j++) {
          const a1Locks = agentGroups.get(agentIds[i])!;
          const a2Locks = agentGroups.get(agentIds[j])!;

          const agent1: ConflictAgent = {
            agentId: agentIds[i],
            role: a1Locks[0].role ?? 'unknown',
            files: a1Locks.map(l => l.filePath),
            taskId: a1Locks[0].taskId ?? null,
          };

          const agent2: ConflictAgent = {
            agentId: agentIds[j],
            role: a2Locks[0].role ?? 'unknown',
            files: a2Locks.map(l => l.filePath),
            taskId: a2Locks[0].taskId ?? null,
          };

          const allFiles = [...a1Locks, ...a2Locks].map(l => l.filePath);
          const conflictFiles: ConflictFile[] = allFiles.map(fp => ({
            path: fp,
            agents: [agentIds[i], agentIds[j]].filter(
              aid => a1Locks.some(l => l.filePath === fp && l.agentId === aid)
                  || a2Locks.some(l => l.filePath === fp && l.agentId === aid)
            ),
            editType: 'locked' as const,
            risk: 'indirect' as const,
          }));

          // Severity: same parent dir = high, same grandparent = medium
          const severity = 'high'; // Same directory → always high

          alerts.push({
            id: generateConflictId(),
            type: 'same_directory',
            severity,
            agents: [agent1, agent2],
            files: conflictFiles,
            description: `Agents ${agentIds[i]} and ${agentIds[j]} are both working in ${dir}`,
            detectedAt: new Date().toISOString(),
            status: 'active',
          });
        }
      }
    }

    // Also check for subdirectory overlaps (grandparent relationship)
    // Build a map of agent → set of parent directories
    const agentDirs = new Map<string, Set<string>>();
    for (const lock of locks) {
      const dirs = agentDirs.get(lock.agentId) ?? new Set();
      dirs.add(path.dirname(lock.filePath));
      agentDirs.set(lock.agentId, dirs);
    }

    const agentIds = [...agentDirs.keys()];
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const dirs1 = agentDirs.get(agentIds[i])!;
        const dirs2 = agentDirs.get(agentIds[j])!;

        for (const d1 of dirs1) {
          for (const d2 of dirs2) {
            if (d1 === d2) continue; // Already handled above

            // Check if one is a subdirectory of the other (grandparent relationship)
            const isSubdir = d1.startsWith(d2 + '/') || d2.startsWith(d1 + '/');
            if (!isSubdir) continue;

            // Check we haven't already created this pair for a same-directory conflict
            const key = this.generateConflictKey('same_directory', agentIds[i], agentIds[j]);
            const alreadyExists = alerts.some(a =>
              this.generateConflictKey(a.type, a.agents[0].agentId, a.agents[1].agentId) === key
              && a.severity === 'high'
            );
            // Only add medium if we don't already have a high for this pair
            const hasHighForPair = alerts.some(a => {
              const aKey = this.generateConflictKey(a.type, a.agents[0].agentId, a.agents[1].agentId);
              return aKey === key && a.severity === 'high';
            });

            if (hasHighForPair) continue;

            // Already have a medium? skip
            const hasMediumForPair = alerts.some(a => {
              const aKey = this.generateConflictKey(a.type, a.agents[0].agentId, a.agents[1].agentId);
              return aKey === key && a.severity === 'medium';
            });
            if (hasMediumForPair) continue;

            const a1Locks = locks.filter(l => l.agentId === agentIds[i]);
            const a2Locks = locks.filter(l => l.agentId === agentIds[j]);

            const agent1: ConflictAgent = {
              agentId: agentIds[i],
              role: a1Locks[0]?.role ?? 'unknown',
              files: a1Locks.map(l => l.filePath),
              taskId: a1Locks[0]?.taskId ?? null,
            };

            const agent2: ConflictAgent = {
              agentId: agentIds[j],
              role: a2Locks[0]?.role ?? 'unknown',
              files: a2Locks.map(l => l.filePath),
              taskId: a2Locks[0]?.taskId ?? null,
            };

            const parentDir = d1.length < d2.length ? d1 : d2;
            const childDir = d1.length < d2.length ? d2 : d1;

            const allFiles = [...a1Locks, ...a2Locks].map(l => l.filePath);
            const conflictFiles: ConflictFile[] = allFiles.map(fp => ({
              path: fp,
              agents: [agentIds[i], agentIds[j]].filter(
                aid => locks.some(l => l.filePath === fp && l.agentId === aid)
              ),
              editType: 'locked' as const,
              risk: 'indirect' as const,
            }));

            alerts.push({
              id: generateConflictId(),
              type: 'same_directory',
              severity: 'medium',
              agents: [agent1, agent2],
              files: conflictFiles,
              description: `Agents ${agentIds[i]} and ${agentIds[j]} are working in related directories ${parentDir} and ${childDir}`,
              detectedAt: new Date().toISOString(),
              status: 'active',
            });
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Detect import overlaps using heuristics.
   * V1 simplified: if two agents have locks in the same directory and one file's
   * name suggests it imports the other (e.g., X.test.ts + X.ts, or index.ts in
   * same dir), flag as import_overlap.
   */
  private detectImportOverlap(locks: FileLockInfo[], recentEdits: RecentEdit[]): ConflictAlert[] {
    const alerts: ConflictAlert[] = [];

    // Combine locks and recent edits into a unified file-agent map
    const fileAgentMap = new Map<string, { agentId: string; role: string; taskId: string | null; source: 'locked' | 'recently_edited' }[]>();

    for (const lock of locks) {
      const existing = fileAgentMap.get(lock.filePath) ?? [];
      existing.push({
        agentId: lock.agentId,
        role: lock.role ?? 'unknown',
        taskId: lock.taskId ?? null,
        source: 'locked',
      });
      fileAgentMap.set(lock.filePath, existing);
    }

    for (const edit of recentEdits) {
      const existing = fileAgentMap.get(edit.filePath) ?? [];
      // Don't duplicate if already in locks
      if (!existing.some(e => e.agentId === edit.agentId)) {
        existing.push({
          agentId: edit.agentId,
          role: edit.role ?? 'unknown',
          taskId: null,
          source: 'recently_edited',
        });
        fileAgentMap.set(edit.filePath, existing);
      }
    }

    // Group files by directory
    const dirFiles = new Map<string, string[]>();
    for (const filePath of fileAgentMap.keys()) {
      const dir = path.dirname(filePath);
      const existing = dirFiles.get(dir) ?? [];
      existing.push(filePath);
      dirFiles.set(dir, existing);
    }

    // For each directory, check for import-related file pairs
    for (const [dir, files] of dirFiles) {
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const file1 = files[i];
          const file2 = files[j];

          if (!this.areImportRelated(file1, file2)) continue;

          const agents1 = fileAgentMap.get(file1) ?? [];
          const agents2 = fileAgentMap.get(file2) ?? [];

          // Check if different agents are working on related files
          for (const a1 of agents1) {
            for (const a2 of agents2) {
              if (a1.agentId === a2.agentId) continue;

              const agent1: ConflictAgent = {
                agentId: a1.agentId,
                role: a1.role,
                files: [file1],
                taskId: a1.taskId,
              };

              const agent2: ConflictAgent = {
                agentId: a2.agentId,
                role: a2.role,
                files: [file2],
                taskId: a2.taskId,
              };

              const conflictFiles: ConflictFile[] = [
                {
                  path: file1,
                  agents: [a1.agentId],
                  editType: a1.source === 'locked' ? 'locked' : 'recently_edited',
                  risk: 'indirect',
                },
                {
                  path: file2,
                  agents: [a2.agentId],
                  editType: a2.source === 'locked' ? 'locked' : 'recently_edited',
                  risk: 'indirect',
                },
              ];

              alerts.push({
                id: generateConflictId(),
                type: 'import_overlap',
                severity: 'medium',
                agents: [agent1, agent2],
                files: conflictFiles,
                description: `Agents ${a1.agentId} and ${a2.agentId} are editing import-related files in ${dir}`,
                detectedAt: new Date().toISOString(),
                status: 'active',
              });
            }
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Detect lock contention — when two agents lock the same file or overlapping globs.
   */
  private detectLockContention(locks: FileLockInfo[]): ConflictAlert[] {
    const alerts: ConflictAlert[] = [];

    for (let i = 0; i < locks.length; i++) {
      for (let j = i + 1; j < locks.length; j++) {
        const lock1 = locks[i];
        const lock2 = locks[j];

        if (lock1.agentId === lock2.agentId) continue;

        const isExactMatch = lock1.filePath === lock2.filePath;
        const isGlobMatch = !isExactMatch && (
          simpleGlobMatch(lock1.filePath, lock2.filePath) ||
          simpleGlobMatch(lock2.filePath, lock1.filePath)
        );

        if (!isExactMatch && !isGlobMatch) continue;

        const agent1: ConflictAgent = {
          agentId: lock1.agentId,
          role: lock1.role ?? 'unknown',
          files: [lock1.filePath],
          taskId: lock1.taskId ?? null,
        };

        const agent2: ConflictAgent = {
          agentId: lock2.agentId,
          role: lock2.role ?? 'unknown',
          files: [lock2.filePath],
          taskId: lock2.taskId ?? null,
        };

        const conflictFiles: ConflictFile[] = [];
        if (isExactMatch) {
          conflictFiles.push({
            path: lock1.filePath,
            agents: [lock1.agentId, lock2.agentId],
            editType: 'locked',
            risk: 'direct',
          });
        } else {
          conflictFiles.push(
            {
              path: lock1.filePath,
              agents: [lock1.agentId],
              editType: 'locked',
              risk: 'direct',
            },
            {
              path: lock2.filePath,
              agents: [lock2.agentId],
              editType: 'locked',
              risk: 'direct',
            },
          );
        }

        alerts.push({
          id: generateConflictId(),
          type: 'lock_contention',
          severity: isExactMatch ? 'high' : 'medium',
          agents: [agent1, agent2],
          files: conflictFiles,
          description: isExactMatch
            ? `Agents ${lock1.agentId} and ${lock2.agentId} both locked ${lock1.filePath}`
            : `Agent ${lock1.agentId}'s lock on ${lock1.filePath} overlaps with ${lock2.agentId}'s lock on ${lock2.filePath}`,
          detectedAt: new Date().toISOString(),
          status: 'active',
        });
      }
    }

    return alerts;
  }

  // ── Private: Merging ──────────────────────────────────────────

  /**
   * Merge newly detected conflicts with existing ones.
   * Deduplicates by conflict key, updates existing active conflicts,
   * and respects resolved/dismissed status.
   * Returns list of newly created conflicts.
   */
  private mergeConflicts(newConflicts: ConflictAlert[]): ConflictAlert[] {
    const created: ConflictAlert[] = [];

    for (const candidate of newConflicts) {
      const key = this.generateConflictKey(
        candidate.type,
        candidate.agents[0].agentId,
        candidate.agents[1].agentId,
      );

      // Check if a conflict with the same key already exists
      let existing: ConflictAlert | undefined;
      for (const c of this.conflicts.values()) {
        const cKey = this.generateConflictKey(c.type, c.agents[0].agentId, c.agents[1].agentId);
        if (cKey === key) {
          existing = c;
          break;
        }
      }

      if (existing) {
        if (existing.status === 'active') {
          // Update files list on existing active conflict
          existing.files = candidate.files;
          existing.description = candidate.description;
        }
        // If resolved or dismissed, don't re-create — respect user's resolution
        continue;
      }

      // New conflict — add it
      this.conflicts.set(candidate.id, candidate);
      created.push(candidate);
    }

    return created;
  }

  /**
   * Generate a deterministic key for a conflict type + agent pair.
   * Sorted agent IDs ensure consistent key regardless of order.
   */
  private generateConflictKey(type: ConflictType, agent1: string, agent2: string): string {
    return `${type}:${[agent1, agent2].sort().join(':')}`;
  }

  // ── Private: Heuristics ───────────────────────────────────────

  /**
   * Check if two files in the same directory are likely import-related.
   * Heuristic — checks if two files in the same directory are likely import-related.
   */
  private areImportRelated(file1: string, file2: string): boolean {
    const base1 = path.basename(file1);
    const base2 = path.basename(file2);

    // Strip extensions for comparison
    const name1 = this.stripExtensions(base1);
    const name2 = this.stripExtensions(base2);

    // X.test.ts + X.ts (or X.spec.ts + X.ts)
    const testSuffix1 = name1.replace(/\.(test|spec)$/, '');
    const testSuffix2 = name2.replace(/\.(test|spec)$/, '');
    if (testSuffix1 !== name1 && testSuffix1 === name2) return true;
    if (testSuffix2 !== name2 && testSuffix2 === name1) return true;

    // index.ts typically imports other files in the same directory
    if (base1 === 'index.ts' || base1 === 'index.js' || base1 === 'index.tsx') return true;
    if (base2 === 'index.ts' || base2 === 'index.js' || base2 === 'index.tsx') return true;

    return false;
  }

  /**
   * Strip file extensions like .ts, .js, .tsx, .jsx
   */
  private stripExtensions(filename: string): string {
    return filename.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  }

  // ── Private: Persistence ──────────────────────────────────────

  private loadConflicts(): ConflictAlert[] {
    try {
      const raw = this.db.getSetting(SETTINGS_KEY_CONFLICTS);
      if (raw) {
        const parsed = JSON.parse(raw) as ConflictAlert[];
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      logger.warn('conflicts', 'Failed to load conflicts, starting fresh');
    }
    return [];
  }

  private saveConflicts(): void {
    try {
      // Prune old resolved/dismissed conflicts
      const now = Date.now();
      const entries = [...this.conflicts.entries()];
      for (const [id, conflict] of entries) {
        if (conflict.status !== 'active') {
          const detectedTime = new Date(conflict.detectedAt).getTime();
          if (now - detectedTime > PRUNE_AGE_MS) {
            this.conflicts.delete(id);
          }
        }
      }

      // Enforce max limit — remove oldest resolved/dismissed first, then oldest active
      if (this.conflicts.size > MAX_CONFLICTS) {
        const sorted = [...this.conflicts.entries()].sort((a, b) => {
          // Resolved/dismissed before active
          if (a[1].status !== 'active' && b[1].status === 'active') return -1;
          if (a[1].status === 'active' && b[1].status !== 'active') return 1;
          // Oldest first
          return new Date(a[1].detectedAt).getTime() - new Date(b[1].detectedAt).getTime();
        });
        const toRemove = sorted.slice(0, this.conflicts.size - MAX_CONFLICTS);
        for (const [id] of toRemove) {
          this.conflicts.delete(id);
        }
      }

      this.db.setSetting(
        SETTINGS_KEY_CONFLICTS,
        JSON.stringify([...this.conflicts.values()]),
      );
    } catch (err) {
      logger.error('conflicts', 'Failed to save conflicts');
    }
  }

  private loadConfig(): ConflictDetectionConfig {
    if (this.configStore) {
      return { ...this.configStore.current.conflicts };
    }
    try {
      const raw = this.db.getSetting(SETTINGS_KEY_CONFIG);
      if (raw) {
        const parsed = JSON.parse(raw) as ConflictDetectionConfig;
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      logger.warn('conflicts', 'Failed to load config, using defaults');
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    if (this.configStore) {
      this.configStore.writePartial({ conflicts: this.config }).catch(err => {
        logger.warn({ module: 'conflicts', msg: 'Failed to save config', err: (err as Error).message });
      });
      return;
    }
    try {
      this.db.setSetting(SETTINGS_KEY_CONFIG, JSON.stringify(this.config));
    } catch (err) {
      logger.error('conflicts', 'Failed to save config');
    }
  }
}
