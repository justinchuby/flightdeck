import { EventEmitter } from 'events';
import type { DagTask } from './TaskDAG.js';
import { logger } from '../utils/logger.js';

/** Minimal interface EagerScheduler needs from any DAG source */
export interface TaskDAGLike {
  getAll(): DagTask[];
}

export interface PreAssignment {
  taskId: string;
  agentId?: string;  // Pre-spawned agent, if any
  readyCondition: string[];  // Task IDs that must complete before this task is ready
  assignedAt: number;
}

/**
 * EagerScheduler pre-assigns agents to tasks that are 1 dependency away from
 * being ready, eliminating the 30-60 second gap between a task completing and
 * the next dependent task starting.
 *
 * A task is "almost ready" when it has exactly 1 unsatisfied dependency and
 * that dependency is currently running.
 */
export class EagerScheduler extends EventEmitter {
  private preAssignments: Map<string, PreAssignment> = new Map();
  private evaluateTimer: ReturnType<typeof setInterval> | null = null;
  private taskDAG: TaskDAGLike;
  private enabled: boolean = true;

  constructor(taskDAG: TaskDAGLike) {
    super();
    this.taskDAG = taskDAG;
  }

  /** Start periodic evaluation */
  start(intervalMs: number = 15_000): void {
    if (this.evaluateTimer) return;
    this.evaluateTimer = setInterval(() => this.evaluate(), intervalMs);
    logger.info({ module: 'timer', msg: 'Started eager task evaluation' });
  }

  stop(): void {
    if (this.evaluateTimer) {
      clearInterval(this.evaluateTimer);
      this.evaluateTimer = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Evaluate the DAG and identify "almost ready" tasks.
   * A task is "almost ready" if it has exactly 1 unsatisfied dependency
   * and that dependency is currently running.
   */
  evaluate(): PreAssignment[] {
    if (!this.enabled) return [];

    const allTasks = this.taskDAG.getAll();
    const taskMap = new Map<string, DagTask>(allTasks.map(t => [t.id, t]));
    const newAssignments: PreAssignment[] = [];

    for (const task of allTasks) {
      // Only look at blocked or pending tasks that haven't started yet
      if (task.dagStatus !== 'blocked' && task.dagStatus !== 'pending') continue;
      // Skip if already pre-assigned
      if (this.preAssignments.has(task.id)) continue;

      const deps = task.dependsOn ?? [];
      if (deps.length === 0) continue;

      // Count unsatisfied dependencies (anything not done/skipped)
      const unsatisfiedDeps = deps.filter((depId: string) => {
        const depTask = taskMap.get(depId);
        // If dep doesn't exist it was cancelled — treat as satisfied
        if (!depTask) return false;
        return depTask.dagStatus !== 'done' && depTask.dagStatus !== 'skipped';
      });

      // "Almost ready" = exactly 1 unsatisfied dep that is running
      if (unsatisfiedDeps.length === 1) {
        const blockingTask = taskMap.get(unsatisfiedDeps[0]);
        if (blockingTask && blockingTask.dagStatus === 'running') {
          const assignment: PreAssignment = {
            taskId: task.id,
            readyCondition: [...unsatisfiedDeps],
            assignedAt: Date.now(),
          };
          this.preAssignments.set(task.id, assignment);
          newAssignments.push(assignment);
          this.emit('task:pre-assigned', assignment);
          logger.info({ module: 'timer', msg: 'Task pre-assigned', taskId: task.id, description: task.description, waitingOn: unsatisfiedDeps[0] });
        }
      }
    }

    // Clean up stale pre-assignments (task no longer exists, completed, or cancelled)
    for (const [taskId] of this.preAssignments) {
      const task = taskMap.get(taskId);
      if (!task || task.dagStatus === 'done' || task.dagStatus === 'skipped' || task.dagStatus === 'failed') {
        this.preAssignments.delete(taskId);
      }
    }

    return newAssignments;
  }

  /**
   * Called when a task completes. Returns task IDs that are now fully unblocked
   * (all their pre-assignment conditions have been satisfied).
   */
  onTaskCompleted(completedTaskId: string): string[] {
    const readyTasks: string[] = [];

    for (const [taskId, assignment] of this.preAssignments) {
      const remaining = assignment.readyCondition.filter(id => id !== completedTaskId);
      if (remaining.length === 0) {
        const elapsedMs = Date.now() - assignment.assignedAt;
        readyTasks.push(taskId);
        this.preAssignments.delete(taskId);
        this.emit('task:ready', { taskId, preAssignedAt: assignment.assignedAt, delayMs: elapsedMs });
        logger.info({ module: 'timer', msg: 'Task ready', taskId, preAssignedSecs: Math.round(elapsedMs / 1000) });
      } else {
        assignment.readyCondition = remaining;
      }
    }

    return readyTasks;
  }

  /** Get all current pre-assignments (for display / API) */
  getPreAssignments(): PreAssignment[] {
    return [...this.preAssignments.values()];
  }

  /** Get pre-assignment for a specific task */
  getPreAssignment(taskId: string): PreAssignment | undefined {
    return this.preAssignments.get(taskId);
  }

  get preAssignmentCount(): number {
    return this.preAssignments.size;
  }
}
