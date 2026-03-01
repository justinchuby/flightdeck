import { EventEmitter } from 'events';
import { eq, and, desc, asc, sql, ne } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { dagTasks } from '../db/schema.js';

export type DagTaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'blocked' | 'paused' | 'skipped';

/** Valid source states for each state transition method */
export const VALID_TRANSITIONS: Record<string, DagTaskStatus[]> = {
  start:    ['ready'],
  complete: ['running', 'ready'],
  fail:     ['running'],
  pause:    ['pending', 'ready'],
  resume:   ['paused'],
  retry:    ['failed'],
  skip:     ['pending', 'ready', 'blocked', 'paused', 'failed'],
  cancel:   ['pending', 'ready', 'blocked', 'paused', 'failed', 'skipped'],
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
  role: string;
  description: string;
  files: string[];
  dependsOn: string[];
  dagStatus: DagTaskStatus;
  priority: number;
  model?: string;
  assignedAgentId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface DagTaskInput {
  id: string;
  role: string;
  description?: string;
  files?: string[];
  depends_on?: string[];
  priority?: number;
  model?: string;
}

export interface FileConflict {
  file: string;
  tasks: string[];
}

function rowToTask(row: typeof dagTasks.$inferSelect): DagTask {
  return {
    id: row.id,
    leadId: row.leadId,
    role: row.role,
    description: row.description,
    files: JSON.parse(row.files || '[]'),
    dependsOn: JSON.parse(row.dependsOn || '[]'),
    dagStatus: row.dagStatus as DagTaskStatus,
    priority: row.priority ?? 0,
    model: row.model || undefined,
    assignedAgentId: row.assignedAgentId || undefined,
    createdAt: row.createdAt!,
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
  declareTaskBatch(leadId: string, tasks: DagTaskInput[]): { tasks: DagTask[]; conflicts: FileConflict[] } {
    // Validate: all depends_on reference tasks in this batch or already existing
    const taskIds = new Set(tasks.map(t => t.id));
    const existingRows = this.db.drizzle
      .select({ id: dagTasks.id })
      .from(dagTasks)
      .where(eq(dagTasks.leadId, leadId))
      .all();
    const existingIds = new Set(existingRows.map(r => r.id));
    const allIds = new Set([...taskIds, ...existingIds]);

    for (const task of tasks) {
      for (const dep of task.depends_on || []) {
        if (!allIds.has(dep)) {
          throw new Error(`Task "${task.id}" depends on unknown task "${dep}"`);
        }
      }
      if (existingIds.has(task.id)) {
        throw new Error(`Task "${task.id}" already exists for this lead`);
      }
    }

    // Detect file conflicts (tasks that share files without explicit dependency)
    const conflicts = this.detectFileConflicts(tasks);

    // Insert tasks
    const inserted: DagTask[] = [];
    for (const task of tasks) {
      const dagStatus = (task.depends_on && task.depends_on.length > 0) ? 'pending' : 'ready';
      this.db.drizzle.insert(dagTasks).values({
        id: task.id,
        leadId,
        role: task.role,
        description: task.description || '',
        files: JSON.stringify(task.files || []),
        dependsOn: JSON.stringify(task.depends_on || []),
        priority: task.priority || 0,
        model: task.model || null,
        dagStatus,
      }).run();
      inserted.push(this.getTask(leadId, task.id)!);
    }

    this.emit('dag:updated', { leadId });
    return { tasks: inserted, conflicts };
  }

  /** Detect file conflicts: tasks that overlap files without dependency relationship */
  private detectFileConflicts(tasks: DagTaskInput[]): FileConflict[] {
    const fileToTasks = new Map<string, string[]>();
    for (const task of tasks) {
      for (const file of task.files || []) {
        const normalized = file.replace(/\/+$/, '');
        if (!fileToTasks.has(normalized)) fileToTasks.set(normalized, []);
        fileToTasks.get(normalized)!.push(task.id);
      }
    }

    const conflicts: FileConflict[] = [];
    for (const [file, ids] of fileToTasks) {
      if (ids.length > 1) {
        // Check if all pairs have a dependency relationship
        const hasDep = (a: string, b: string): boolean => {
          const taskA = tasks.find(t => t.id === a);
          const taskB = tasks.find(t => t.id === b);
          return (taskA?.depends_on || []).includes(b) || (taskB?.depends_on || []).includes(a);
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
      .where(and(eq(dagTasks.leadId, leadId), eq(dagTasks.dagStatus, 'pending')))
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
        running.files.some(rf =>
          f === rf || f.startsWith(rf + '/') || rf.startsWith(f + '/'),
        ),
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
      .set({ dagStatus: 'running', assignedAgentId: agentId })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    this.emit('dag:updated', { leadId });
    return this.getTask(leadId, taskId);
  }

  /** Mark a task as complete. Returns newly ready tasks, or null if transition is invalid. */
  completeTask(leadId: string, taskId: string): DagTask[] | null {
    const error = this.validateTransition(leadId, taskId, 'complete');
    if (error) return null;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'done', completedAt: sql`datetime('now')` })
      .where(and(eq(dagTasks.id, taskId), eq(dagTasks.leadId, leadId)))
      .run();
    const newlyReady = this.resolveReady(leadId);
    // Auto-promote newly ready tasks from pending to ready
    for (const task of newlyReady) {
      this.db.drizzle
        .update(dagTasks)
        .set({ dagStatus: 'ready' })
        .where(and(eq(dagTasks.id, task.id), eq(dagTasks.leadId, leadId), eq(dagTasks.dagStatus, 'pending')))
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
      .set({ dagStatus: 'failed', completedAt: sql`datetime('now')` })
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
      return dep && (dep.dagStatus === 'done' || dep.dagStatus === 'skipped');
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

  /** Skip a task (mark as skipped, unblock dependents with warning) */
  skipTask(leadId: string, taskId: string): boolean {
    const error = this.validateTransition(leadId, taskId, 'skip');
    if (error) return false;
    this.db.drizzle
      .update(dagTasks)
      .set({ dagStatus: 'skipped', completedAt: sql`datetime('now')` })
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
  addTask(leadId: string, task: DagTaskInput): DagTask {
    const result = this.declareTaskBatch(leadId, [task]);
    return result.tasks[0];
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

  /** Find a ready DAG task matching a role (for auto-linking DELEGATE to DAG) */
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
}
