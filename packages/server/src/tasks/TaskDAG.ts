import { EventEmitter } from 'events';
import { eq, and, desc, asc, sql, ne, inArray, lte } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { dagTasks, utcNow } from '../db/schema.js';

export type DagTaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'blocked' | 'paused' | 'skipped';

/** Valid source states for each state transition method */
export const VALID_TRANSITIONS: Record<string, DagTaskStatus[]> = {
  start:    ['ready'],
  complete: ['running', 'paused', 'ready'],
  fail:     ['running'],
  pause:    ['pending', 'ready'],
  resume:   ['paused'],
  retry:    ['failed'],
  reopen:   ['done'],
  skip:     ['pending', 'ready', 'running', 'blocked', 'paused', 'failed'],
  cancel:   ['pending', 'ready', 'blocked', 'paused', 'failed', 'skipped'],
  forceReady: ['pending', 'blocked'],
};

export interface InvalidTransitionError {
  taskId: string;
  currentStatus: DagTaskStatus | 'not_found';
  attemptedAction: string;
  validStatuses: DagTaskStatus[];
}

export interface DagTask {
  id: string;
  leadId: string;
  projectId?: string;
  role: string;
  title?: string;
  description: string;
  files: string[];
  dependsOn: string[];
  dagStatus: DagTaskStatus;
  priority: number;
  model?: string;
  assignedAgentId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DagTaskInput {
  taskId: string;
  role: string;
  title?: string;
  description?: string;
  files?: string[];
  dependsOn?: string[];
  priority?: number;
  model?: string;
}

export interface FileConflict {
  file: string;
  tasks: string[];
}

/**
 * Minimum Dice coefficient score to consider a description match meaningful.
 * A single shared word between two 3-word phrases scores ~0.33;
 * 0.2 catches partial matches while filtering noise from unrelated descriptions.
 */
const MIN_DESCRIPTION_MATCH_THRESHOLD = 0.2;

/**
 * Minimum gap between top-2 candidate scores to trust description-based matching.
 * If the gap is smaller, the match is ambiguous and we fall back to priority order.
 */
const MIN_SCORE_GAP = 0.15;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'for', 'on',
  'and', 'or', 'with', 'that', 'this', 'it', 'from', 'by', 'as', 'at',
  'be', 'do', 'not', 'all', 'if', 'no', 'so', 'implement', 'fix', 'add',
  'update', 'create', 'write', 'make', 'use', 'task', 'work',
]);

/** Extract meaningful words from text for similarity comparison */
function extractWords(text: string): Set<string> {
  // Preserve hyphenated tokens (e.g. "p2-7", "auto-link") as single words
  const tokens = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')   // keep hyphens
    .split(/\s+/)
    .flatMap(token => {
      // Keep hyphenated tokens AND their parts for better matching
      if (token.includes('-') && token.length > 2) {
        const parts = token.split('-').filter(p => p.length > 0);
        return [token, ...parts];
      }
      return [token];
    })
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/**
 * Compute similarity between a delegation task description and a DAG task's description/title.
 * Returns a score between 0 and 1 (Dice coefficient of meaningful word overlap).
 */
export function descriptionSimilarity(delegationText: string, dagDescription: string, dagTitle?: string): number {
  const delegationWords = extractWords(delegationText);
  if (delegationWords.size === 0) return 0;

  const dagText = dagTitle ? `${dagTitle} ${dagDescription}` : dagDescription;
  const dagWords = extractWords(dagText);
  if (dagWords.size === 0) return 0;

  const shared = [...delegationWords].filter(w => dagWords.has(w)).length;
  return (2 * shared) / (delegationWords.size + dagWords.size);
}

function rowToTask(row: typeof dagTasks.$inferSelect): DagTask {
  return {
    id: row.id,
    leadId: row.leadId,
    projectId: row.projectId || undefined,
    role: row.role,
    title: row.title || undefined,
    description: row.description,
    files: JSON.parse(row.files || '[]'),
    dependsOn: JSON.parse(row.dependsOn || '[]'),
    dagStatus: row.dagStatus as DagTaskStatus,
    priority: row.priority ?? 0,
    model: row.model || undefined,
    assignedAgentId: row.assignedAgentId || undefined,
    createdAt: row.createdAt!,
    startedAt: row.startedAt || undefined,
    completedAt: row.completedAt || undefined,
  };
}

export class TaskDAG extends EventEmitter {
  private db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  /** Declare a batch of tasks for a lead. Validates deps and detects file conflicts. */
  declareTaskBatch(leadId: string, tasks: DagTaskInput[], projectId?: string): { tasks: DagTask[]; conflicts: FileConflict[]; linkedAutoTasks: Array<{ declaredId: string; autoId: string }> } {
    // Validate: all dependsOn reference tasks in this batch or already existing
    const taskIds = new Set(tasks.map(t => t.taskId));
    const existingRows = this.db.drizzle
      .select({ id: dagTasks.id })
      .from(dagTasks)
      .where(eq(dagTasks.leadId, leadId))
      .all();
    const existingIds = new Set(existingRows.map(r => r.id));
    const allIds = new Set([...taskIds, ...existingIds]);

    // Build a list of existing auto-created tasks for dedup matching
    const existingAutoTasks = this.getTasks(leadId).filter(t =>
      t.id.startsWith('auto-') && !['done', 'skipped'].includes(t.dagStatus)
    );
    // Track which auto-tasks have already been linked to avoid double-linking
    const linkedAutoIds = new Set<string>();
    // Map from declared task ID → auto task ID for dedup results
    const linkedAutoTasks: Array<{ declaredId: string; autoId: string }> = [];

    for (const task of tasks) {
      for (const dep of task.dependsOn || []) {
        if (!allIds.has(dep)) {
          throw new Error(`Task "${task.taskId}" depends on unknown task "${dep}"`);
        }
      }
      // Skip duplicate check for tasks that will be deduped against auto-created tasks
      if (existingIds.has(task.taskId)) {
        throw new Error(`Task "${task.taskId}" already exists for this lead`);
      }
    }

    // Detect file conflicts (tasks that share files without explicit dependency)
    const conflicts = this.detectFileConflicts(tasks);

    // Insert tasks (with auto-DAG dedup)
    const inserted: DagTask[] = [];
    for (const task of tasks) {
      // Check for matching auto-created task (same role + similar description)
      const autoMatch = existingAutoTasks.find(auto =>
        !linkedAutoIds.has(auto.id)
        && auto.role === task.role
        && descriptionSimilarity(task.description || '', auto.description, auto.title) > 0.7
      );

      if (autoMatch) {
        // Reuse existing auto-created task: update its metadata to match the declared task
        linkedAutoIds.add(autoMatch.id);
        this.db.drizzle.update(dagTasks)
          .set({
            title: task.title || autoMatch.title || null,
            description: task.description || autoMatch.description,
            files: JSON.stringify(task.files || []),
            dependsOn: JSON.stringify(task.dependsOn || []),
            priority: task.priority || autoMatch.priority,
            model: task.model || autoMatch.model || null,
          })
          .where(and(eq(dagTasks.id, autoMatch.id), eq(dagTasks.leadId, leadId)))
          .run();
        // Add the declared ID as an alias so dependsOn references resolve
        allIds.add(autoMatch.id);
        linkedAutoTasks.push({ declaredId: task.taskId, autoId: autoMatch.id });
        inserted.push(this.getTask(leadId, autoMatch.id)!);
      } else {
        // Check if all dependencies are already satisfied at creation time.
        // Without this, tasks added after their deps complete stay 'pending' forever
        // because resolveReady() is only called reactively inside completeTask/skipTask.
        let dagStatus: DagTaskStatus = 'ready';
        if (task.dependsOn && task.dependsOn.length > 0) {
          const allDepsSatisfied = task.dependsOn.every(depId => {
            const dep = this.getTask(leadId, depId);
            return !dep || dep.dagStatus === 'done' || dep.dagStatus === 'skipped';
          });
          dagStatus = allDepsSatisfied ? 'ready' : 'pending';
        }
        this.db.drizzle.insert(dagTasks).values({
          id: task.taskId,
          leadId,
          projectId: projectId || null,
          role: task.role,
          title: task.title || null,
          description: task.description || '',
          files: JSON.stringify(task.files || []),
          dependsOn: JSON.stringify(task.dependsOn || []),
          priority: task.priority || 0,
          model: task.model || null,
          dagStatus,
        }).run();
        inserted.push(this.getTask(leadId, task.taskId)!);
      }
    }

    // Promote any tasks whose deps are now satisfied (handles cross-batch resolution
    // where a dep from a previous batch completed between batch declarations)
    const newlyReady = this.resolveReady(leadId);
    for (const t of newlyReady) {
      this.db.drizzle
        .update(dagTasks)
        .set({ dagStatus: 'ready' })
        .where(and(eq(dagTasks.id, t.id), eq(dagTasks.leadId, leadId), inArray(dagTasks.dagStatus, ['pending', 'blocked'])))
        .run();
    }

    this.emit('dag:updated', { leadId });
    return { tasks: inserted, conflicts, linkedAutoTasks };
  }

  /** Detect file conflicts: tasks that overlap files without dependency relationship */
  private detectFileConflicts(tasks: DagTaskInput[]): FileConflict[] {
    const fileToTasks = new Map<string, string[]>();
    for (const task of tasks) {
      for (const file of task.files || []) {
        const normalized = file.replace(/\/+$/, '');
        if (!fileToTasks.has(normalized)) fileToTasks.set(normalized, []);
        fileToTasks.get(normalized)!.push(task.taskId);
      }
    }

    const conflicts: FileConflict[] = [];
    for (const [file, ids] of fileToTasks) {
      if (ids.length > 1) {
        // Check if all pairs have a dependency relationship
        const hasDep = (a: string, b: string): boolean => {
          const taskA = tasks.find(t => t.taskId === a);
          const taskB = tasks.find(t => t.taskId === b);
          return (taskA?.dependsOn || []).includes(b) || (taskB?.dependsOn || []).includes(a);
        };

        let allHaveDeps = true;
        for (let i = 0; i < ids.length && allHaveDeps; i++) {
          for (let j = i + 1; j < ids.length && allHaveDeps; j++) {
            if (!hasDep(ids[i], ids[j])) {
              allHaveDeps = false;
            }
          }
        }

        if (!allHaveDeps) {
          conflicts.push({ file, tasks: ids });
        }
      }
    }
    return conflicts;
  }

  /** Resolve which tasks are ready to run (all deps done, files available) */
  resolveReady(leadId: string): DagTask[] {
    const pendingTasks = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(eq(dagTasks.leadId, leadId), inArray(dagTasks.dagStatus, ['pending', 'blocked'])))
      .all()
      .map(rowToTask);

    const ready: DagTask[] = [];
    for (const task of pendingTasks) {
      const allDepsDone = task.dependsOn.every(depId => {
        const dep = this.getTask(leadId, depId);
        // null means dep was cancelled (deleted) — treat as satisfied
        return !dep || dep.dagStatus === 'done' || dep.dagStatus === 'skipped';
      });

      if (allDepsDone) {
        const filesAvailable = this.areFilesAvailable(leadId, task.id, task.files);
        if (filesAvailable) {
          ready.push(task);
        }
      }
    }
    return ready;
  }

  /** Check if files are available (not held by another running task) */
  private areFilesAvailable(leadId: string, taskId: string, files: string[]): boolean {
    if (files.length === 0) return true;

    const runningTasks = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(eq(dagTasks.leadId, leadId), eq(dagTasks.dagStatus, 'running'), ne(dagTasks.id, taskId)))
      .all()
      .map(rowToTask);

    for (const running of runningTasks) {
      const overlap = files.some(f =>
        running.files.some(rf => {
          const nf = f.replace(/\\/g, '/');
          const nrf = rf.replace(/\\/g, '/');
          return nf === nrf || nf.startsWith(nrf + '/') || nrf.startsWith(nf + '/');
        }),
      );
      if (overlap) return false;
    }
    return true;
  }

  /** Validate that a state transition is allowed, returning an error object if not */
  private validateTransition(leadId: string, taskId: string, action: string): InvalidTransitionError | null {
    const task = this.getTask(leadId, taskId);
    const validStatuses = VALID_TRANSITIONS[action];
    if (!task) {
      return { taskId, currentStatus: 'not_found', attemptedAction: action, validStatuses };
    }
    if (!validStatuses.includes(task.dagStatus)) {
      return { taskId, currentStatus: task.dagStatus, attemptedAction: action, validStatuses };
    }
    return null;
  }

  /** Format an InvalidTransitionError into a human-readable message */
  static formatTransitionError(error: InvalidTransitionError): string {
    if (error.currentStatus === 'not_found') {
      return `Cannot ${error.attemptedAction} task "${error.taskId}": task not found.`;
    }
    return `Cannot ${error.attemptedAction} task "${error.taskId}": current status is "${error.currentStatus}". Valid source states: [${error.validStatuses.join(', ')}].`;
  }

  /** Mark a task as running and assign to an agent */
  startTask(leadId: string, taskId: string, agentId: string): DagTask | null {
    const error = this.validateTransition(leadId, taskId, 'start');
    if (error) return null;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'running', assignedAgentId: agentId, startedAt: utcNow })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return this.getTask(leadId, taskId);
  }

  /**
   * Force-start a task from any non-terminal, non-running state.
   * Used when the lead explicitly delegates work that matches a declared DAG task
   * which isn't yet 'ready' (e.g., pending or blocked).
   */
  forceStartTask(leadId: string, taskId: string, agentId: string): DagTask | null {
    const task = this.getTask(leadId, taskId);
    if (!task) return null;
    const terminalOrRunning: DagTaskStatus[] = ['done', 'skipped', 'running'];
    if (terminalOrRunning.includes(task.dagStatus)) return null;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'running', assignedAgentId: agentId, startedAt: utcNow })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return this.getTask(leadId, taskId);
  }

  /** Reassign a running task to a different agent. Returns the old agent ID, or null if invalid. */
  reassignTask(leadId: string, taskId: string, newAgentId: string): { oldAgentId: string } | null {
    const task = this.getTask(leadId, taskId);
    if (!task || task.dagStatus !== 'running' || !task.assignedAgentId) return null;
    const oldAgentId = task.assignedAgentId;
    this.db.drizzle
      .update(dagTasks)
      .set({ assignedAgentId: newAgentId })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return { oldAgentId };
  }

  /** Mark a task as complete. Returns newly ready tasks, or null if transition is invalid. */
  completeTask(leadId: string, taskId: string): DagTask[] | null {
    const error = this.validateTransition(leadId, taskId, 'complete');
    if (error) return null;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'done', completedAt: utcNow })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    const newlyReady = this.resolveReady(leadId);
    // Auto-promote newly ready tasks from pending/blocked to ready
    for (const task of newlyReady) {
      this.db.drizzle
        .update(dagTasks)
        .set({ dagStatus: 'ready' })
        .where(and(eq(dagTasks.id, task.id), eq(dagTasks.leadId, leadId), inArray(dagTasks.dagStatus, ['pending', 'blocked'])))
        .run();
    }
    this.emit('dag:updated', { leadId });
    return newlyReady;
  }

  /** Mark a task as failed. Block dependents. Returns false if transition is invalid. */
  failTask(leadId: string, taskId: string): boolean {
    const error = this.validateTransition(leadId, taskId, 'fail');
    if (error) return false;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'failed', completedAt: utcNow })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    // Block all tasks that depend on this one
    const allTasks = this.getTasks(leadId);
    for (const task of allTasks) {
      if (task.dependsOn.includes(taskId) && (task.dagStatus === 'pending' || task.dagStatus === 'ready')) {
        this.db.drizzle
          .update(dagTasks)
          .set({ dagStatus: 'blocked' })
          .where(and(eq(dagTasks.id, task.id), eq(dagTasks.leadId, leadId)))
          .run();
      }
    }
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Pause a task (hold even if dependencies are met) */
  pauseTask(leadId: string, taskId: string): boolean {
    const error = this.validateTransition(leadId, taskId, 'pause');
    if (error) return false;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'paused' })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Resume a paused task */
  resumeTask(leadId: string, taskId: string): boolean {
    const error = this.validateTransition(leadId, taskId, 'resume');
    if (error) return false;
    const task = this.getTask(leadId, taskId)!;
    const newStatus = task.dependsOn.every(depId => {
      const dep = this.getTask(leadId, depId);
      // null means dep was cancelled (deleted) — treat as satisfied, consistent with resolveReady
      return !dep || dep.dagStatus === 'done' || dep.dagStatus === 'skipped';
    }) ? 'ready' : 'pending';
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: newStatus })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Retry a failed task (reset to ready, optionally reassign) */
  retryTask(leadId: string, taskId: string): boolean {
    const error = this.validateTransition(leadId, taskId, 'retry');
    if (error) return false;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'ready', assignedAgentId: null, completedAt: null })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    // Unblock dependents that were blocked by this failure
    const allTasks = this.getTasks(leadId);
    for (const t of allTasks) {
      if (t.dependsOn.includes(taskId) && t.dagStatus === 'blocked') {
        this.db.drizzle
          .update(dagTasks)
          .set({ dagStatus: 'pending' })
          .where(and(eq(dagTasks.id, t.id), eq(dagTasks.leadId, leadId)))
          .run();
      }
    }
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Reopen a completed task (revert done → ready/pending based on deps) */
  reopenTask(leadId: string, taskId: string): DagTask | null {
    const error = this.validateTransition(leadId, taskId, 'reopen');
    if (error) return null;
    const task = this.getTask(leadId, taskId)!;
    const depsOk = task.dependsOn.every(depId => {
      const dep = this.getTask(leadId, depId);
      // null means dep was cancelled (deleted) — treat as satisfied, consistent with resolveReady
      return !dep || dep.dagStatus === 'done' || dep.dagStatus === 'skipped';
    });
    const newStatus = depsOk ? 'ready' : 'pending';
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: newStatus, completedAt: null, assignedAgentId: null })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return this.getTask(leadId, taskId)!;
  }

  /** Force a pending/blocked task to ready state, bypassing dependency checks */
  forceReady(leadId: string, taskId: string): DagTask | null {
    const error = this.validateTransition(leadId, taskId, 'forceReady');
    if (error) return null;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'ready' })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return this.getTask(leadId, taskId)!;
  }

  /** Skip a task (mark as skipped, unblock dependents with warning).
   *  Returns the previously assigned agent ID if the task was running, or true/false. */
  skipTask(leadId: string, taskId: string): boolean | { skippedAgentId: string } {
    const error = this.validateTransition(leadId, taskId, 'skip');
    if (error) return false;
    const task = this.getTask(leadId, taskId);
    const wasRunning = task?.dagStatus === 'running';
    const previousAgentId = task?.assignedAgentId;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'skipped', assignedAgentId: null, completedAt: utcNow })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    // Resolve newly ready tasks (skipped counts as "done" for dependency resolution)
    const newlyReady = this.resolveReady(leadId);
    for (const t of newlyReady) {
      this.db.run(
        `UPDATE dag_tasks SET dag_status = 'ready' WHERE id = ? AND lead_id = ? AND dag_status IN ('pending', 'blocked')`,
        [t.id, leadId],
      );
    }
    this.emit('dag:updated', { leadId });
    if (wasRunning && previousAgentId) {
      return { skippedAgentId: previousAgentId };
    }
    return true;
  }

  /** Cancel a task (remove from DAG entirely) */
  cancelTask(leadId: string, taskId: string): boolean {
    const error = this.validateTransition(leadId, taskId, 'cancel');
    if (error) return false;
    this.db.drizzle
      .delete(dagTasks)
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    // Resolve dependents — cancelled task no longer blocks them
    const newlyReady = this.resolveReady(leadId);
    for (const t of newlyReady) {
      this.db.run(
        `UPDATE dag_tasks SET dag_status = 'ready' WHERE id = ? AND lead_id = ? AND dag_status IN ('pending', 'blocked')`,
        [t.id, leadId],
      );
    }
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Add a single task to an existing DAG */
  addTask(leadId: string, task: DagTaskInput, projectId?: string): DagTask {
    const result = this.declareTaskBatch(leadId, [task], projectId);
    return result.tasks[0];
  }

  /** Add a dependency between two tasks. Returns false if task not found or would create a cycle. */
  addDependency(leadId: string, taskId: string, dependsOnId: string): boolean {
    const task = this.getTask(leadId, taskId);
    const dep = this.getTask(leadId, dependsOnId);
    if (!task || !dep) return false;
    if (task.dependsOn.includes(dependsOnId)) return true; // already exists
    if (this.wouldCreateCycle(leadId, taskId, dependsOnId)) return false;
    const deps = [...task.dependsOn, dependsOnId];
    this.db.drizzle.update(dagTasks)
      .set({ dependsOn: JSON.stringify(deps) })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    // If the dependency isn't done/skipped yet, block this task —
    // but only if the task isn't already running or done (don't regress active/completed work)
    if (dep.dagStatus !== 'done' && dep.dagStatus !== 'skipped'
        && task.dagStatus !== 'running' && task.dagStatus !== 'done' && task.dagStatus !== 'failed') {
      this.db.drizzle.update(dagTasks)
        .set({ dagStatus: 'blocked' })
        .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
        .run();
    }
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Check if adding dependsOnId as a dependency of taskId would create a cycle */
  wouldCreateCycle(leadId: string, taskId: string, dependsOnId: string): boolean {
    // If dependsOnId transitively depends on taskId, adding this edge creates a cycle
    const visited = new Set<string>();
    const queue = [dependsOnId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (current === taskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const t = this.getTask(leadId, current);
      if (t) queue.push(...t.dependsOn);
    }
    return false;
  }

  /** Get a single task */
  getTask(leadId: string, taskId: string): DagTask | null {
    const row = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .get();
    return row ? rowToTask(row) : null;
  }

  /** Get all tasks for a lead */
  getTasks(leadId: string): DagTask[] {
    return this.db.drizzle
      .select()
      .from(dagTasks)
      .where(eq(dagTasks.leadId, leadId))
      .orderBy(desc(dagTasks.priority), asc(dagTasks.createdAt))
      .all()
      .map(rowToTask);
  }

  /** Get all tasks scoped to a project (across all leads in that project) */
  getTasksByProject(projectId: string): DagTask[] {
    return this.db.drizzle
      .select()
      .from(dagTasks)
      .where(eq(dagTasks.projectId, projectId))
      .orderBy(desc(dagTasks.priority), asc(dagTasks.createdAt))
      .all()
      .map(rowToTask);
  }

  /** Get all tasks across all leads (used by EagerScheduler and global queries) */
  getAll(): DagTask[] {
    return this.db.drizzle
      .select()
      .from(dagTasks)
      .orderBy(desc(dagTasks.priority), asc(dagTasks.createdAt))
      .all()
      .map(rowToTask);
  }

  /** Lightweight check: does this lead have any tasks in the DAG? */
  hasAnyTasks(leadId: string): boolean {
    const row = this.db.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(dagTasks)
      .where(eq(dagTasks.leadId, leadId))
      .get();
    return (row?.count ?? 0) > 0;
  }

  /** Lightweight check: does this lead have active (non-terminal) tasks? */
  hasActiveTasks(leadId: string): boolean {
    const row = this.db.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(dagTasks)
      .where(and(
        eq(dagTasks.leadId, leadId),
        ne(dagTasks.dagStatus, 'done'),
        ne(dagTasks.dagStatus, 'skipped'),
        ne(dagTasks.dagStatus, 'failed'),
      ))
      .get();
    return (row?.count ?? 0) > 0;
  }

  /** Get full DAG status (for TASK_STATUS command) */
  getStatus(leadId: string): {
    tasks: DagTask[];
    fileLockMap: Record<string, { taskId: string; agentId?: string }>;
    summary: { pending: number; ready: number; running: number; done: number; failed: number; blocked: number; paused: number; skipped: number };
  } {
    const tasks = this.getTasks(leadId);
    const fileLockMap: Record<string, { taskId: string; agentId?: string }> = {};

    for (const task of tasks) {
      if (task.dagStatus === 'running') {
        for (const file of task.files) {
          fileLockMap[file] = { taskId: task.id, agentId: task.assignedAgentId };
        }
      }
    }

    const summary = { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 };
    for (const task of tasks) {
      summary[task.dagStatus as keyof typeof summary]++;
    }

    return { tasks, fileLockMap, summary };
  }

  /** Find task by assigned agent ID (checks running first, then ready as fallback) */
  getTaskByAgent(leadId: string, agentId: string): DagTask | null {
    // Primary: look for running tasks assigned to this agent
    const running = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(
        eq(dagTasks.leadId, leadId),
        eq(dagTasks.assignedAgentId, agentId),
        eq(dagTasks.dagStatus, 'running'),
      ))
      .get();
    if (running) return rowToTask(running);

    // Fallback: look for ready tasks assigned to this agent (edge case safety net)
    const ready = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(
        eq(dagTasks.leadId, leadId),
        eq(dagTasks.assignedAgentId, agentId),
        eq(dagTasks.dagStatus, 'ready'),
      ))
      .get();
    return ready ? rowToTask(ready) : null;
  }

  /**
   * Find a ready DAG task matching a role (for auto-linking DELEGATE to DAG).
   * @deprecated Use {@link findReadyTask} instead, which supports dagTaskId + description fuzzy matching.
   */
  findReadyTaskByRole(leadId: string, role: string): DagTask | null {
    const row = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(
        eq(dagTasks.leadId, leadId),
        eq(dagTasks.role, role),
        eq(dagTasks.dagStatus, 'ready'),
      ))
      .orderBy(desc(dagTasks.priority), asc(dagTasks.createdAt))
      .get();
    return row ? rowToTask(row) : null;
  }

  /**
   * Find a ready DAG task using smart matching.
   * Priority: 1) explicit dagTaskId, 2) role + description fuzzy match, 3) role-only fallback.
   */
  findReadyTask(leadId: string, options: { dagTaskId?: string; role: string; taskDescription?: string }): DagTask | null {
    // Primary: explicit dagTaskId lookup
    if (options.dagTaskId) {
      const task = this.getTask(leadId, options.dagTaskId);
      if (task && task.dagStatus === 'ready') return task;
      // Auto-resolve: if task is pending but deps are already satisfied, promote to ready.
      // This is a safety net for any code path that missed calling resolveReady().
      if (task && task.dagStatus === 'pending') {
        const allDepsSatisfied = task.dependsOn.every(depId => {
          const dep = this.getTask(leadId, depId);
          return !dep || dep.dagStatus === 'done' || dep.dagStatus === 'skipped';
        });
        if (allDepsSatisfied) {
          this.db.drizzle.update(dagTasks)
            .set({ dagStatus: 'ready' })
            .where(and(eq(dagTasks.id, task.id), eq(dagTasks.leadId, leadId)))
            .run();
          this.emit('dag:updated', { leadId });
          return { ...task, dagStatus: 'ready' };
        }
      }
      return null;
    }

    // Get all ready tasks for this role
    const candidates = this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(
        eq(dagTasks.leadId, leadId),
        eq(dagTasks.role, options.role),
        eq(dagTasks.dagStatus, 'ready'),
      ))
      .orderBy(desc(dagTasks.priority), asc(dagTasks.createdAt))
      .all()
      .map(rowToTask);

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Multiple candidates with same role — use description to disambiguate
    if (options.taskDescription) {
      const scored = candidates.map(task => ({
        task,
        score: descriptionSimilarity(options.taskDescription!, task.description, task.title),
      }));
      scored.sort((a, b) => b.score - a.score);

      if (scored[0].score > MIN_DESCRIPTION_MATCH_THRESHOLD) {
        // Require clear winner — if top-2 scores are too close, fall back to priority
        const gap = scored.length > 1 ? scored[0].score - scored[1].score : 1;
        if (gap >= MIN_SCORE_GAP) {
          return scored[0].task;
        }
      }
    }

    // Multiple candidates but no clear description match — return null to force explicit dagTaskId
    // (returning candidates[0] was the bug: it silently linked to the wrong task)
    return null;
  }

  /** Get a transition validation error (for use by CommandDispatcher error messages) */
  getTransitionError(leadId: string, taskId: string, action: string): InvalidTransitionError | null {
    return this.validateTransition(leadId, taskId, action);
  }

  /** Reset (clear) all DAG tasks for a lead */
  resetDAG(leadId: string): number {
    const tasks = this.getTasks(leadId);
    if (tasks.length === 0) return 0;
    this.db.drizzle
      .delete(dagTasks)
      .where(eq(dagTasks.leadId, leadId))
      .run();
    this.emit('dag:updated', { leadId });
    return tasks.length;
  }

  /** Get tasks as they existed at a given timestamp (for replay) */
  getTasksAt(leadId: string, timestamp: string): DagTask[] {
    return this.db.drizzle
      .select()
      .from(dagTasks)
      .where(and(eq(dagTasks.leadId, leadId), lte(dagTasks.createdAt, timestamp)))
      .orderBy(desc(dagTasks.priority), asc(dagTasks.createdAt))
      .all()
      .map(rowToTask)
      .map(task => ({
        ...task,
        dagStatus: this.reconstructStatusAt(task, timestamp),
      }));
  }

  private reconstructStatusAt(task: DagTask, timestamp: string): DagTaskStatus {
    if (task.completedAt && task.completedAt <= timestamp) {
      return task.dagStatus === 'skipped' ? 'skipped'
        : task.dagStatus === 'failed' ? 'failed'
        : 'done';
    }
    if (task.startedAt && task.startedAt <= timestamp) return 'running';
    return 'pending';
  }
}
