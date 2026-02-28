import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { TaskDAG, VALID_TRANSITIONS } from '../tasks/TaskDAG.js';
import type { DagTaskInput, DagTask } from '../tasks/TaskDAG.js';

const TEST_DB = ':memory:';

describe('TaskDAG', () => {
  let db: Database;
  let dag: TaskDAG;

  beforeEach(() => {
    db = new Database(TEST_DB);
    dag = new TaskDAG(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('declareTaskBatch', () => {
    it('inserts tasks and returns them', () => {
      const tasks: DagTaskInput[] = [
        { id: 'task-1', role: 'Developer', description: 'Build API' },
        { id: 'task-2', role: 'Developer', description: 'Build UI', depends_on: ['task-1'] },
      ];
      const result = dag.declareTaskBatch('lead-1', tasks);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].id).toBe('task-1');
      expect(result.tasks[0].dagStatus).toBe('ready');
      expect(result.tasks[1].id).toBe('task-2');
      expect(result.tasks[1].dagStatus).toBe('pending');
    });

    it('sets ready status for tasks with no dependencies', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev' },
      ]);
      expect(result.tasks[0].dagStatus).toBe('ready');
      expect(result.tasks[1].dagStatus).toBe('ready');
    });

    it('sets pending status for tasks with dependencies', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      expect(result.tasks[1].dagStatus).toBe('pending');
    });

    it('throws on unknown dependency', () => {
      expect(() => {
        dag.declareTaskBatch('lead-1', [
          { id: 'a', role: 'Dev', depends_on: ['nonexistent'] },
        ]);
      }).toThrow('Task "a" depends on unknown task "nonexistent"');
    });

    it('throws on duplicate task ID within lead', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(() => {
        dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      }).toThrow('Task "a" already exists for this lead');
    });

    it('allows same task ID under different leads', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      const result = dag.declareTaskBatch('lead-2', [{ id: 'a', role: 'Dev' }]);
      expect(result.tasks).toHaveLength(1);
    });

    it('allows cross-batch dependency references', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      expect(result.tasks[0].dependsOn).toEqual(['a']);
    });

    it('emits dag:updated event', () => {
      let emitted: any = null;
      dag.on('dag:updated', (data) => { emitted = data; });
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(emitted).toEqual({ leadId: 'lead-1' });
    });

    it('stores files and priority correctly', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/index.ts', 'src/utils.ts'], priority: 10 },
      ]);
      expect(result.tasks[0].files).toEqual(['src/index.ts', 'src/utils.ts']);
      expect(result.tasks[0].priority).toBe(10);
    });

    it('stores model field', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', model: 'gpt-4o' },
      ]);
      expect(result.tasks[0].model).toBe('gpt-4o');
    });
  });

  describe('detectFileConflicts', () => {
    it('detects overlapping files between independent tasks', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/index.ts'] },
        { id: 'b', role: 'Dev', files: ['src/index.ts'] },
      ]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].file).toBe('src/index.ts');
      expect(result.conflicts[0].tasks).toEqual(['a', 'b']);
    });

    it('does not flag conflicts when tasks have dependency relationship', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/index.ts'] },
        { id: 'b', role: 'Dev', files: ['src/index.ts'], depends_on: ['a'] },
      ]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('does not flag conflicts when files are disjoint', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/a.ts'] },
        { id: 'b', role: 'Dev', files: ['src/b.ts'] },
      ]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('normalizes trailing slashes', () => {
      const result = dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/dir/'] },
        { id: 'b', role: 'Dev', files: ['src/dir'] },
      ]);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  describe('resolveReady', () => {
    it('finds tasks with all deps done', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
        { id: 'c', role: 'Dev', depends_on: ['b'] },
      ]);
      // a is ready, b and c are pending.
      // Complete a => b should become ready
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');

      const ready = dag.resolveReady('lead-1');
      // b was already promoted by completeTask, but if we check pending tasks directly,
      // there should be none left that are ready (they were promoted to 'ready' already)
      // Let's check the actual statuses
      const b = dag.getTask('lead-1', 'b')!;
      expect(b.dagStatus).toBe('ready');
      const c = dag.getTask('lead-1', 'c')!;
      expect(c.dagStatus).toBe('pending');
    });

    it('returns empty when no tasks are pending', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      // 'a' is already ready, not pending
      const ready = dag.resolveReady('lead-1');
      expect(ready).toHaveLength(0);
    });

    it('blocks task when running task holds overlapping files', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/shared.ts'] },
        { id: 'b', role: 'Dev', files: ['src/other.ts'] },
        { id: 'c', role: 'Dev', files: ['src/shared.ts'], depends_on: ['b'] },
      ]);

      // Start 'a' (holds src/shared.ts)
      dag.startTask('lead-1', 'a', 'agent-1');

      // Complete 'b' => 'c' deps are met, but src/shared.ts is held by running 'a'
      dag.startTask('lead-1', 'b', 'agent-2');
      dag.completeTask('lead-1', 'b');

      // resolveReady should NOT include 'c' because 'a' still holds src/shared.ts
      const ready = dag.resolveReady('lead-1');
      const readyIds = ready.map(t => t.id);
      expect(readyIds).not.toContain('c');
    });

    it('detects directory-prefix file overlaps', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/components'] },
        { id: 'b', role: 'Dev' },
        { id: 'c', role: 'Dev', files: ['src/components/Button.tsx'], depends_on: ['b'] },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');
      dag.startTask('lead-1', 'b', 'agent-2');
      dag.completeTask('lead-1', 'b');

      const ready = dag.resolveReady('lead-1');
      expect(ready.map(t => t.id)).not.toContain('c');
    });

    it('allows task when files do not overlap', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/a.ts'] },
        { id: 'b', role: 'Dev' },
        { id: 'c', role: 'Dev', files: ['src/c.ts'], depends_on: ['b'] },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');
      dag.startTask('lead-1', 'b', 'agent-2');

      // completeTask promotes c to ready since its dep (b) is done and
      // a holds src/a.ts which does not overlap src/c.ts
      const newlyReady = dag.completeTask('lead-1', 'b');
      expect(newlyReady).not.toBeNull();
      expect(newlyReady!.map(t => t.id)).toContain('c');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('ready');
    });
  });

  describe('completeTask', () => {
    it('marks task as done and promotes dependents', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      dag.startTask('lead-1', 'a', 'agent-1');
      const newlyReady = dag.completeTask('lead-1', 'a');

      const a = dag.getTask('lead-1', 'a')!;
      expect(a.dagStatus).toBe('done');
      expect(a.completedAt).toBeTruthy();

      // b should have been promoted
      expect(newlyReady!.map(t => t.id)).toContain('b');
      const b = dag.getTask('lead-1', 'b')!;
      expect(b.dagStatus).toBe('ready');
    });

    it('does not promote task with multiple deps until all done', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev' },
        { id: 'c', role: 'Dev', depends_on: ['a', 'b'] },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');
      const afterA = dag.completeTask('lead-1', 'a');
      expect(afterA!.map(t => t.id)).not.toContain('c');

      const c1 = dag.getTask('lead-1', 'c')!;
      expect(c1.dagStatus).toBe('pending');

      dag.startTask('lead-1', 'b', 'agent-2');
      const afterB = dag.completeTask('lead-1', 'b');
      expect(afterB!.map(t => t.id)).toContain('c');

      const c2 = dag.getTask('lead-1', 'c')!;
      expect(c2.dagStatus).toBe('ready');
    });

    it('emits dag:updated event', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      const events: any[] = [];
      dag.on('dag:updated', (data) => events.push(data));
      dag.completeTask('lead-1', 'a');
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('failTask', () => {
    it('marks task as failed and blocks dependents', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
        { id: 'c', role: 'Dev', depends_on: ['b'] },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');
      dag.failTask('lead-1', 'a');

      const a = dag.getTask('lead-1', 'a')!;
      expect(a.dagStatus).toBe('failed');
      expect(a.completedAt).toBeTruthy();

      const b = dag.getTask('lead-1', 'b')!;
      expect(b.dagStatus).toBe('blocked');

      // c is also pending but doesn't directly depend on a, so it stays pending
      const c = dag.getTask('lead-1', 'c')!;
      expect(c.dagStatus).toBe('pending');
    });

    it('emits dag:updated event', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      let emitted = false;
      dag.on('dag:updated', () => { emitted = true; });
      dag.failTask('lead-1', 'a');
      expect(emitted).toBe(true);
    });
  });

  describe('pauseTask / resumeTask', () => {
    it('pauses a pending task', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      const paused = dag.pauseTask('lead-1', 'b');
      expect(paused).toBe(true);
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('paused');
    });

    it('pauses a ready task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      const paused = dag.pauseTask('lead-1', 'a');
      expect(paused).toBe(true);
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('paused');
    });

    it('returns false for running task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      const paused = dag.pauseTask('lead-1', 'a');
      expect(paused).toBe(false);
    });

    it('resumes paused task to ready when deps are met', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.pauseTask('lead-1', 'a');
      const resumed = dag.resumeTask('lead-1', 'a');
      expect(resumed).toBe(true);
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('ready');
    });

    it('resumes paused task to pending when deps are not met', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      dag.pauseTask('lead-1', 'b');
      const resumed = dag.resumeTask('lead-1', 'b');
      expect(resumed).toBe(true);
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('pending');
    });

    it('returns false when resuming non-paused task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      const resumed = dag.resumeTask('lead-1', 'a');
      expect(resumed).toBe(false);
    });
  });

  describe('retryTask', () => {
    it('resets failed task to ready and unblocks dependents', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');
      dag.failTask('lead-1', 'a');
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('blocked');

      const retried = dag.retryTask('lead-1', 'a');
      expect(retried).toBe(true);

      const a = dag.getTask('lead-1', 'a')!;
      expect(a.dagStatus).toBe('ready');
      expect(a.assignedAgentId).toBeUndefined();
      expect(a.completedAt).toBeUndefined();

      const b = dag.getTask('lead-1', 'b')!;
      expect(b.dagStatus).toBe('pending');
    });

    it('returns false for non-failed task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(dag.retryTask('lead-1', 'a')).toBe(false);
    });

    it('returns false for nonexistent task', () => {
      expect(dag.retryTask('lead-1', 'nope')).toBe(false);
    });
  });

  describe('skipTask', () => {
    it('marks task as skipped and unblocks dependents', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);

      const skipped = dag.skipTask('lead-1', 'a');
      expect(skipped).toBe(true);

      const a = dag.getTask('lead-1', 'a')!;
      expect(a.dagStatus).toBe('skipped');
      expect(a.completedAt).toBeTruthy();

      const b = dag.getTask('lead-1', 'b')!;
      expect(b.dagStatus).toBe('ready');
    });

    it('returns false for done task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');
      expect(dag.skipTask('lead-1', 'a')).toBe(false);
    });

    it('returns false for running task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      expect(dag.skipTask('lead-1', 'a')).toBe(false);
    });

    it('can skip a blocked task to unblock dependents', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
        { id: 'c', role: 'Dev', depends_on: ['b'] },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');
      dag.failTask('lead-1', 'a');
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('blocked');

      // Skip blocked b
      dag.skipTask('lead-1', 'b');
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('skipped');

      // c should now be ready (b is skipped = treated as done)
      const c = dag.getTask('lead-1', 'c')!;
      expect(c.dagStatus).toBe('ready');
    });
  });

  describe('cancelTask', () => {
    it('removes a pending task', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      const cancelled = dag.cancelTask('lead-1', 'b');
      expect(cancelled).toBe(true);
      expect(dag.getTask('lead-1', 'b')).toBeNull();
    });

    it('removes a ready task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(dag.cancelTask('lead-1', 'a')).toBe(true);
      expect(dag.getTask('lead-1', 'a')).toBeNull();
    });

    it('does NOT remove a running task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      expect(dag.cancelTask('lead-1', 'a')).toBe(false);
      expect(dag.getTask('lead-1', 'a')).not.toBeNull();
    });

    it('does NOT remove a done task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');
      expect(dag.cancelTask('lead-1', 'a')).toBe(false);
    });

    it('returns false for nonexistent task', () => {
      expect(dag.cancelTask('lead-1', 'nope')).toBe(false);
    });

    it('unblocks dependents when cancelled task is removed', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
        { id: 'c', role: 'Dev', depends_on: ['b'] },
      ]);
      // a is ready, b and c are pending
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('ready');
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('pending');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('pending');

      // Cancel a → b should become ready (dep removed), c still pending (depends on b)
      dag.cancelTask('lead-1', 'a');
      expect(dag.getTask('lead-1', 'a')).toBeNull();
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('ready');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('pending');

      // Cancel b → c should become ready
      dag.cancelTask('lead-1', 'b');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('ready');
    });

    it('unblocks dependents with multiple cancelled deps (diamond)', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev' },
        { id: 'c', role: 'Dev', depends_on: ['a', 'b'] },
      ]);
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('pending');

      // Cancel a — c still pending (depends on b too)
      dag.cancelTask('lead-1', 'a');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('pending');

      // Cancel b — c should now be ready (both deps removed)
      dag.cancelTask('lead-1', 'b');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('ready');
    });
  });

  describe('addTask', () => {
    it('adds a single task to an existing DAG', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      const task = dag.addTask('lead-1', { id: 'b', role: 'Dev', depends_on: ['a'] });
      expect(task.id).toBe('b');
      expect(task.dependsOn).toEqual(['a']);
      expect(task.dagStatus).toBe('pending');
    });

    it('adds a task with no deps as ready', () => {
      const task = dag.addTask('lead-1', { id: 'a', role: 'Dev' });
      expect(task.dagStatus).toBe('ready');
    });
  });

  describe('startTask', () => {
    it('marks task as running and assigns agent', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      const task = dag.startTask('lead-1', 'a', 'agent-1');
      expect(task).not.toBeNull();
      expect(task!.dagStatus).toBe('running');
      expect(task!.assignedAgentId).toBe('agent-1');
    });
  });

  describe('getStatus', () => {
    it('returns full DAG state with summary and file lock map', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev', files: ['src/a.ts'] },
        { id: 'b', role: 'Dev', files: ['src/b.ts'], depends_on: ['a'] },
        { id: 'c', role: 'Dev' },
      ]);

      dag.startTask('lead-1', 'a', 'agent-1');

      const status = dag.getStatus('lead-1');
      expect(status.tasks).toHaveLength(3);
      expect(status.summary.running).toBe(1);
      expect(status.summary.pending).toBe(1);
      expect(status.summary.ready).toBe(1);
      expect(status.summary.done).toBe(0);

      expect(status.fileLockMap['src/a.ts']).toEqual({ taskId: 'a', agentId: 'agent-1' });
      expect(status.fileLockMap['src/b.ts']).toBeUndefined();
    });

    it('returns empty for unknown lead', () => {
      const status = dag.getStatus('nonexistent');
      expect(status.tasks).toHaveLength(0);
      expect(status.summary.pending).toBe(0);
    });
  });

  describe('getTaskByAgent', () => {
    it('finds a running task by agent', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      const task = dag.getTaskByAgent('lead-1', 'agent-1');
      expect(task).not.toBeNull();
      expect(task!.id).toBe('a');
    });

    it('returns null for agent with no running task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(dag.getTaskByAgent('lead-1', 'agent-1')).toBeNull();
    });

    it('returns null for done task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');
      expect(dag.getTaskByAgent('lead-1', 'agent-1')).toBeNull();
    });
  });

  describe('getTasks', () => {
    it('returns tasks ordered by priority desc then created_at asc', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'low', role: 'Dev', priority: 1 },
        { id: 'high', role: 'Dev', priority: 10 },
        { id: 'mid', role: 'Dev', priority: 5 },
      ]);
      const tasks = dag.getTasks('lead-1');
      expect(tasks[0].id).toBe('high');
      expect(tasks[1].id).toBe('mid');
      expect(tasks[2].id).toBe('low');
    });

    it('scopes to lead', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.declareTaskBatch('lead-2', [{ id: 'b', role: 'Dev' }]);
      expect(dag.getTasks('lead-1')).toHaveLength(1);
      expect(dag.getTasks('lead-2')).toHaveLength(1);
    });
  });

  describe('end-to-end: diamond dependency', () => {
    //     a
    //    / \
    //   b   c
    //    \ /
    //     d
    it('schedules a diamond DAG correctly', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
        { id: 'c', role: 'Dev', depends_on: ['a'] },
        { id: 'd', role: 'Dev', depends_on: ['b', 'c'] },
      ]);

      // a is ready, b/c/d are pending
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('ready');
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('pending');
      expect(dag.getTask('lead-1', 'c')!.dagStatus).toBe('pending');
      expect(dag.getTask('lead-1', 'd')!.dagStatus).toBe('pending');

      // Complete a => b and c become ready
      dag.startTask('lead-1', 'a', 'agent-1');
      const afterA = dag.completeTask('lead-1', 'a');
      const afterAIds = afterA!.map(t => t.id).sort();
      expect(afterAIds).toEqual(['b', 'c']);

      // Complete b => d is still pending (c not done yet)
      dag.startTask('lead-1', 'b', 'agent-2');
      const afterB = dag.completeTask('lead-1', 'b');
      expect(afterB!.map(t => t.id)).not.toContain('d');

      // Complete c => d becomes ready
      dag.startTask('lead-1', 'c', 'agent-3');
      const afterC = dag.completeTask('lead-1', 'c');
      expect(afterC!.map(t => t.id)).toContain('d');
      expect(dag.getTask('lead-1', 'd')!.dagStatus).toBe('ready');

      // Complete d
      dag.startTask('lead-1', 'd', 'agent-4');
      dag.completeTask('lead-1', 'd');

      const status = dag.getStatus('lead-1');
      expect(status.summary.done).toBe(4);
      expect(status.summary.pending).toBe(0);
      expect(status.summary.ready).toBe(0);
      expect(status.summary.running).toBe(0);
    });
  });

  describe('state transition guards', () => {
    it('startTask returns null for non-ready task', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      // b is pending, not ready
      expect(dag.startTask('lead-1', 'b', 'agent-1')).toBeNull();
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('pending');
    });

    it('startTask returns null for already running task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      expect(dag.startTask('lead-1', 'a', 'agent-2')).toBeNull();
    });

    it('startTask returns null for done task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');
      expect(dag.startTask('lead-1', 'a', 'agent-2')).toBeNull();
    });

    it('completeTask returns null for pending task', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      expect(dag.completeTask('lead-1', 'b')).toBeNull();
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('pending');
    });

    it('completeTask returns null for skipped task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.skipTask('lead-1', 'a');
      expect(dag.completeTask('lead-1', 'a')).toBeNull();
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('skipped');
    });

    it('completeTask returns null for paused task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.pauseTask('lead-1', 'a');
      expect(dag.completeTask('lead-1', 'a')).toBeNull();
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('paused');
    });

    it('completeTask returns null for already done task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');
      expect(dag.completeTask('lead-1', 'a')).toBeNull();
    });

    it('completeTask returns null for nonexistent task', () => {
      expect(dag.completeTask('lead-1', 'nonexistent')).toBeNull();
    });

    it('failTask returns false for pending task', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      expect(dag.failTask('lead-1', 'b')).toBe(false);
      expect(dag.getTask('lead-1', 'b')!.dagStatus).toBe('pending');
    });

    it('failTask returns false for ready task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(dag.failTask('lead-1', 'a')).toBe(false);
    });

    it('failTask returns false for done task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      dag.completeTask('lead-1', 'a');
      expect(dag.failTask('lead-1', 'a')).toBe(false);
    });

    it('failTask returns true for running task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.startTask('lead-1', 'a', 'agent-1');
      expect(dag.failTask('lead-1', 'a')).toBe(true);
      expect(dag.getTask('lead-1', 'a')!.dagStatus).toBe('failed');
    });

    it('skipTask returns false for already skipped task', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.skipTask('lead-1', 'a');
      expect(dag.skipTask('lead-1', 'a')).toBe(false);
    });
  });

  describe('getTransitionError', () => {
    it('returns error for invalid transition', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.pauseTask('lead-1', 'a');
      const error = dag.getTransitionError('lead-1', 'a', 'complete');
      expect(error).not.toBeNull();
      expect(error!.currentStatus).toBe('paused');
      expect(error!.attemptedAction).toBe('complete');
      expect(error!.validStatuses).toEqual(VALID_TRANSITIONS.complete);
    });

    it('returns error for nonexistent task', () => {
      const error = dag.getTransitionError('lead-1', 'nope', 'start');
      expect(error).not.toBeNull();
      expect(error!.currentStatus).toBe('not_found');
    });

    it('returns null for valid transition', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(dag.getTransitionError('lead-1', 'a', 'start')).toBeNull();
    });
  });

  describe('formatTransitionError', () => {
    it('formats not_found error', () => {
      const msg = TaskDAG.formatTransitionError({
        taskId: 'x', currentStatus: 'not_found', attemptedAction: 'complete', validStatuses: ['running', 'ready'],
      });
      expect(msg).toContain('task not found');
    });

    it('formats invalid status error', () => {
      const msg = TaskDAG.formatTransitionError({
        taskId: 'x', currentStatus: 'paused', attemptedAction: 'complete', validStatuses: ['running', 'ready'],
      });
      expect(msg).toContain('current status is "paused"');
      expect(msg).toContain('running, ready');
    });
  });

  describe('resetDAG', () => {
    it('removes all tasks for a lead', () => {
      dag.declareTaskBatch('lead-1', [
        { id: 'a', role: 'Dev' },
        { id: 'b', role: 'Dev', depends_on: ['a'] },
      ]);
      const count = dag.resetDAG('lead-1');
      expect(count).toBe(2);
      expect(dag.getTasks('lead-1')).toHaveLength(0);
    });

    it('does not affect other leads', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.declareTaskBatch('lead-2', [{ id: 'b', role: 'Dev' }]);
      dag.resetDAG('lead-1');
      expect(dag.getTasks('lead-1')).toHaveLength(0);
      expect(dag.getTasks('lead-2')).toHaveLength(1);
    });

    it('returns 0 when no tasks exist', () => {
      expect(dag.resetDAG('lead-1')).toBe(0);
    });

    it('emits dag:updated event', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      let emitted = false;
      dag.on('dag:updated', () => { emitted = true; });
      dag.resetDAG('lead-1');
      expect(emitted).toBe(true);
    });

    it('allows re-declaring tasks after reset', () => {
      dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      dag.resetDAG('lead-1');
      const result = dag.declareTaskBatch('lead-1', [{ id: 'a', role: 'Dev' }]);
      expect(result.tasks).toHaveLength(1);
    });
  });
});
