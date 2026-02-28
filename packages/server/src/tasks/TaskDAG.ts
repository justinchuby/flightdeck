import { EventEmitter } from 'events';
import type { Database } from '../db/database.js';

export type DagTaskStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'blocked' | 'paused' | 'skipped';

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

interface DagTaskRow {
  id: string;
  lead_id: string;
  role: string;
  description: string;
  files: string;
  depends_on: string;
  dag_status: string;
  priority: number;
  model: string | null;
  assigned_agent_id: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToTask(row: DagTaskRow): DagTask {
  return {
    id: row.id,
    leadId: row.lead_id,
    role: row.role,
    description: row.description,
    files: JSON.parse(row.files || '[]'),
    dependsOn: JSON.parse(row.depends_on || '[]'),
    dagStatus: row.dag_status as DagTaskStatus,
    priority: row.priority,
    model: row.model || undefined,
    assignedAgentId: row.assigned_agent_id || undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
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
    const existingIds = new Set(
      this.db.all<{ id: string }>('SELECT id FROM dag_tasks WHERE lead_id = ?', [leadId]).map(r => r.id),
    );
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
      this.db.run(
        `INSERT INTO dag_tasks (id, lead_id, role, description, files, depends_on, priority, model, dag_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          leadId,
          task.role,
          task.description || '',
          JSON.stringify(task.files || []),
          JSON.stringify(task.depends_on || []),
          task.priority || 0,
          task.model || null,
          dagStatus,
        ],
      );
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
    const pendingTasks = this.db.all<DagTaskRow>(
      `SELECT * FROM dag_tasks WHERE lead_id = ? AND dag_status = 'pending'`,
      [leadId],
    ).map(rowToTask);

    const ready: DagTask[] = [];
    for (const task of pendingTasks) {
      const allDepsDone = task.dependsOn.every(depId => {
        const dep = this.getTask(leadId, depId);
        return dep && (dep.dagStatus === 'done' || dep.dagStatus === 'skipped');
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

    const runningTasks = this.db.all<DagTaskRow>(
      `SELECT * FROM dag_tasks WHERE lead_id = ? AND dag_status = 'running' AND id != ?`,
      [leadId, taskId],
    ).map(rowToTask);

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

  /** Mark a task as running and assign to an agent */
  startTask(leadId: string, taskId: string, agentId: string): DagTask | null {
    this.db.run(
      `UPDATE dag_tasks SET dag_status = 'running', assigned_agent_id = ? WHERE id = ? AND lead_id = ?`,
      [agentId, taskId, leadId],
    );
    this.emit('dag:updated', { leadId });
    return this.getTask(leadId, taskId);
  }

  /** Mark a task as complete. Returns newly ready tasks. */
  completeTask(leadId: string, taskId: string): DagTask[] {
    this.db.run(
      `UPDATE dag_tasks SET dag_status = 'done', completed_at = datetime('now') WHERE id = ? AND lead_id = ?`,
      [taskId, leadId],
    );
    const newlyReady = this.resolveReady(leadId);
    // Auto-promote newly ready tasks from pending to ready
    for (const task of newlyReady) {
      this.db.run(
        `UPDATE dag_tasks SET dag_status = 'ready' WHERE id = ? AND lead_id = ? AND dag_status = 'pending'`,
        [task.id, leadId],
      );
    }
    this.emit('dag:updated', { leadId });
    return newlyReady;
  }

  /** Mark a task as failed. Block dependents. */
  failTask(leadId: string, taskId: string): void {
    this.db.run(
      `UPDATE dag_tasks SET dag_status = 'failed', completed_at = datetime('now') WHERE id = ? AND lead_id = ?`,
      [taskId, leadId],
    );
    // Block all tasks that depend on this one
    const allTasks = this.getTasks(leadId);
    for (const task of allTasks) {
      if (task.dependsOn.includes(taskId) && (task.dagStatus === 'pending' || task.dagStatus === 'ready')) {
        this.db.run(
          `UPDATE dag_tasks SET dag_status = 'blocked' WHERE id = ? AND lead_id = ?`,
          [task.id, leadId],
        );
      }
    }
    this.emit('dag:updated', { leadId });
  }

  /** Pause a task (hold even if dependencies are met) */
  pauseTask(leadId: string, taskId: string): boolean {
    const result = this.db.run(
      `UPDATE dag_tasks SET dag_status = 'paused' WHERE id = ? AND lead_id = ? AND dag_status IN ('pending', 'ready')`,
      [taskId, leadId],
    );
    if (result.changes > 0) this.emit('dag:updated', { leadId });
    return result.changes > 0;
  }

  /** Resume a paused task */
  resumeTask(leadId: string, taskId: string): boolean {
    const task = this.getTask(leadId, taskId);
    if (!task || task.dagStatus !== 'paused') return false;
    const newStatus = task.dependsOn.every(depId => {
      const dep = this.getTask(leadId, depId);
      return dep && (dep.dagStatus === 'done' || dep.dagStatus === 'skipped');
    }) ? 'ready' : 'pending';
    this.db.run(
      `UPDATE dag_tasks SET dag_status = ? WHERE id = ? AND lead_id = ?`,
      [newStatus, taskId, leadId],
    );
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Retry a failed task (reset to ready, optionally reassign) */
  retryTask(leadId: string, taskId: string): boolean {
    const task = this.getTask(leadId, taskId);
    if (!task || task.dagStatus !== 'failed') return false;
    this.db.run(
      `UPDATE dag_tasks SET dag_status = 'ready', assigned_agent_id = NULL, completed_at = NULL WHERE id = ? AND lead_id = ?`,
      [taskId, leadId],
    );
    // Unblock dependents that were blocked by this failure
    const allTasks = this.getTasks(leadId);
    for (const t of allTasks) {
      if (t.dependsOn.includes(taskId) && t.dagStatus === 'blocked') {
        this.db.run(
          `UPDATE dag_tasks SET dag_status = 'pending' WHERE id = ? AND lead_id = ?`,
          [t.id, leadId],
        );
      }
    }
    this.emit('dag:updated', { leadId });
    return true;
  }

  /** Skip a task (mark as skipped, unblock dependents with warning) */
  skipTask(leadId: string, taskId: string): boolean {
    const task = this.getTask(leadId, taskId);
    if (!task || task.dagStatus === 'done' || task.dagStatus === 'running') return false;
    this.db.run(
      `UPDATE dag_tasks SET dag_status = 'skipped', completed_at = datetime('now') WHERE id = ? AND lead_id = ?`,
      [taskId, leadId],
    );
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
    const result = this.db.run(
      `DELETE FROM dag_tasks WHERE id = ? AND lead_id = ? AND dag_status NOT IN ('running', 'done')`,
      [taskId, leadId],
    );
    if (result.changes > 0) this.emit('dag:updated', { leadId });
    return result.changes > 0;
  }

  /** Add a single task to an existing DAG */
  addTask(leadId: string, task: DagTaskInput): DagTask {
    const result = this.declareTaskBatch(leadId, [task]);
    return result.tasks[0];
  }

  /** Get a single task */
  getTask(leadId: string, taskId: string): DagTask | null {
    const row = this.db.get<DagTaskRow>(
      'SELECT * FROM dag_tasks WHERE id = ? AND lead_id = ?',
      [taskId, leadId],
    );
    return row ? rowToTask(row) : null;
  }

  /** Get all tasks for a lead */
  getTasks(leadId: string): DagTask[] {
    return this.db.all<DagTaskRow>(
      'SELECT * FROM dag_tasks WHERE lead_id = ? ORDER BY priority DESC, created_at ASC',
      [leadId],
    ).map(rowToTask);
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

  /** Find task by assigned agent ID */
  getTaskByAgent(leadId: string, agentId: string): DagTask | null {
    const row = this.db.get<DagTaskRow>(
      `SELECT * FROM dag_tasks WHERE lead_id = ? AND assigned_agent_id = ? AND dag_status = 'running'`,
      [leadId, agentId],
    );
    return row ? rowToTask(row) : null;
  }
}
