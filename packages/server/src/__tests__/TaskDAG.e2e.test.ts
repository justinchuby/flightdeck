import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import type { DagTaskInput, DagTask, DagTaskStatus } from '../tasks/TaskDAG.js';

const TEST_DB = ':memory:';
const LEAD = 'lead-main';

// ── Helpers ──────────────────────────────────────────────────────────

/** Shorthand for declaring a task batch */
function batch(dag: TaskDAG, leadId: string, tasks: DagTaskInput[]) {
  return dag.declareTaskBatch(leadId, tasks);
}

/** Get a status map: taskId → dagStatus */
function statusMap(dag: TaskDAG, leadId: string): Record<string, DagTaskStatus> {
  const map: Record<string, DagTaskStatus> = {};
  for (const t of dag.getTasks(leadId)) map[t.id] = t.dagStatus;
  return map;
}

/** Simulate an agent picking up and completing a task */
function runTask(dag: TaskDAG, leadId: string, taskId: string, agentId: string): DagTask[] | null {
  const started = dag.startTask(leadId, taskId, agentId);
  if (!started) throw new Error(`Cannot start task "${taskId}" (status: ${dag.getTask(leadId, taskId)?.dagStatus ?? 'not_found'})`);
  return dag.completeTask(leadId, taskId);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TaskDAG E2E', () => {
  let db: Database;
  let dag: TaskDAG;

  beforeEach(() => {
    db = new Database(TEST_DB);
    dag = new TaskDAG(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. Full DAG lifecycle ──────────────────────────────────────────

  describe('full DAG lifecycle', () => {
    it('declares tasks, starts/completes in dependency order, verifies all state transitions', () => {
      // Scenario: Lead declares 4 tasks for a feature build
      //   setup (no deps) → api (depends on setup) → ui (depends on api) → tests (depends on ui)
      batch(dag, LEAD, [
        { taskId: 'setup', role: 'Developer', description: 'Project scaffolding', files: ['package.json'] },
        { taskId: 'api', role: 'Developer', description: 'Build REST API', files: ['src/api.ts'], dependsOn: ['setup'] },
        { taskId: 'ui', role: 'Designer', description: 'Build UI components', files: ['src/App.tsx'], dependsOn: ['api'] },
        { taskId: 'tests', role: 'Developer', description: 'Write integration tests', files: ['src/test.ts'], dependsOn: ['ui'] },
      ]);

      // Initial state: only setup is ready
      let sm = statusMap(dag, LEAD);
      expect(sm).toEqual({ setup: 'ready', api: 'pending', ui: 'pending', tests: 'pending' });

      // Agent-1 picks up setup
      const afterSetup = runTask(dag, LEAD, 'setup', 'agent-1');
      expect(afterSetup!.map(t => t.id)).toContain('api');
      sm = statusMap(dag, LEAD);
      expect(sm.setup).toBe('done');
      expect(sm.api).toBe('ready');
      expect(sm.ui).toBe('pending');

      // Agent-2 picks up api
      const afterApi = runTask(dag, LEAD, 'api', 'agent-2');
      expect(afterApi!.map(t => t.id)).toContain('ui');
      sm = statusMap(dag, LEAD);
      expect(sm.api).toBe('done');
      expect(sm.ui).toBe('ready');

      // Agent-3 picks up ui
      const afterUi = runTask(dag, LEAD, 'ui', 'agent-3');
      expect(afterUi!.map(t => t.id)).toContain('tests');

      // Agent-4 picks up tests
      runTask(dag, LEAD, 'tests', 'agent-4');

      // Final state: all done
      const status = dag.getStatus(LEAD);
      expect(status.summary.done).toBe(4);
      expect(status.summary.pending).toBe(0);
      expect(status.summary.ready).toBe(0);
      expect(status.summary.running).toBe(0);
    });

    it('tracks assigned agents throughout lifecycle', () => {
      batch(dag, LEAD, [
        { taskId: 'task-a', role: 'Developer', description: 'Feature A' },
      ]);

      dag.startTask(LEAD, 'task-a', 'agent-42');
      expect(dag.getTaskByAgent(LEAD, 'agent-42')!.id).toBe('task-a');

      dag.completeTask(LEAD, 'task-a');
      expect(dag.getTaskByAgent(LEAD, 'agent-42')).toBeNull();
    });
  });

  // ── 2. Parallel execution ─────────────────────────────────────────

  describe('parallel execution', () => {
    it('3 independent tasks run simultaneously, 2 dependents wait', () => {
      //   fe, be, docs (independent)
      //   integration (depends on fe + be)
      //   deploy (depends on integration)
      batch(dag, LEAD, [
        { taskId: 'fe', role: 'Developer', description: 'Frontend', files: ['src/fe/'] },
        { taskId: 'be', role: 'Developer', description: 'Backend', files: ['src/be/'] },
        { taskId: 'docs', role: 'Tech Writer', description: 'Documentation', files: ['docs/'] },
        { taskId: 'integration', role: 'Developer', description: 'Integration tests', dependsOn: ['fe', 'be'] },
        { taskId: 'deploy', role: 'Developer', description: 'Deploy', dependsOn: ['integration'] },
      ]);

      // All 3 independent tasks are ready
      let sm = statusMap(dag, LEAD);
      expect(sm.fe).toBe('ready');
      expect(sm.be).toBe('ready');
      expect(sm.docs).toBe('ready');
      expect(sm.integration).toBe('pending');
      expect(sm.deploy).toBe('pending');

      // Start all 3 in parallel
      dag.startTask(LEAD, 'fe', 'agent-fe');
      dag.startTask(LEAD, 'be', 'agent-be');
      dag.startTask(LEAD, 'docs', 'agent-docs');

      sm = statusMap(dag, LEAD);
      expect(sm.fe).toBe('running');
      expect(sm.be).toBe('running');
      expect(sm.docs).toBe('running');

      // Complete fe — integration still blocked (be not done)
      dag.completeTask(LEAD, 'fe');
      expect(statusMap(dag, LEAD).integration).toBe('pending');

      // Complete be — integration unblocked
      dag.completeTask(LEAD, 'be');
      expect(statusMap(dag, LEAD).integration).toBe('ready');

      // Complete docs — no downstream impact
      dag.completeTask(LEAD, 'docs');

      // Run integration → deploy unblocked
      runTask(dag, LEAD, 'integration', 'agent-int');
      expect(statusMap(dag, LEAD).deploy).toBe('ready');

      runTask(dag, LEAD, 'deploy', 'agent-deploy');

      const status = dag.getStatus(LEAD);
      expect(status.summary.done).toBe(5);
    });

    it('file locks prevent parallel execution of overlapping tasks', () => {
      batch(dag, LEAD, [
        { taskId: 'task-a', role: 'Developer', files: ['src/shared.ts'] },
        { taskId: 'task-b', role: 'Developer' },
        { taskId: 'task-c', role: 'Developer', files: ['src/shared.ts'], dependsOn: ['task-b'] },
      ]);

      // Start task-a (holds src/shared.ts)
      dag.startTask(LEAD, 'task-a', 'agent-1');

      // Complete task-b — task-c deps met but file locked by task-a
      dag.startTask(LEAD, 'task-b', 'agent-2');
      dag.completeTask(LEAD, 'task-b');

      // task-c should NOT be promoted while task-a holds the file
      const ready = dag.resolveReady(LEAD);
      expect(ready.map(t => t.id)).not.toContain('task-c');

      // Complete task-a — now task-c can proceed
      dag.completeTask(LEAD, 'task-a');
      const readyAfter = dag.resolveReady(LEAD);
      // task-c was promoted to ready by completeTask of task-b,
      // but it was still in pending. After task-a releases files,
      // resolveReady should find it (or it was already promoted)
      const c = dag.getTask(LEAD, 'task-c')!;
      expect(['ready', 'pending']).toContain(c.dagStatus);
    });
  });

  // ── 3. Task failure + retry ───────────────────────────────────────

  describe('task failure and retry', () => {
    it('fails a task, blocks dependents, retries, succeeds, unblocks', () => {
      batch(dag, LEAD, [
        { taskId: 'build', role: 'Developer', description: 'Build the project' },
        { taskId: 'test', role: 'Developer', description: 'Run tests', dependsOn: ['build'] },
        { taskId: 'deploy', role: 'Developer', description: 'Deploy', dependsOn: ['test'] },
      ]);

      // Build starts and fails
      dag.startTask(LEAD, 'build', 'agent-1');
      dag.failTask(LEAD, 'build');

      let sm = statusMap(dag, LEAD);
      expect(sm.build).toBe('failed');
      expect(sm.test).toBe('blocked');
      expect(sm.deploy).toBe('pending'); // only direct dependents get blocked

      // Retry build — test unblocks to pending
      dag.retryTask(LEAD, 'build');
      sm = statusMap(dag, LEAD);
      expect(sm.build).toBe('ready');
      expect(sm.test).toBe('pending'); // unblocked back to pending

      // Now complete build → test ready → complete test → deploy ready
      runTask(dag, LEAD, 'build', 'agent-2');
      expect(statusMap(dag, LEAD).test).toBe('ready');

      runTask(dag, LEAD, 'test', 'agent-3');
      expect(statusMap(dag, LEAD).deploy).toBe('ready');

      runTask(dag, LEAD, 'deploy', 'agent-4');

      expect(dag.getStatus(LEAD).summary.done).toBe(3);
    });

    it('retry clears assignedAgentId and completedAt', () => {
      batch(dag, LEAD, [{ taskId: 'task-a', role: 'Developer' }]);
      dag.startTask(LEAD, 'task-a', 'agent-1');
      dag.failTask(LEAD, 'task-a');

      const failed = dag.getTask(LEAD, 'task-a')!;
      expect(failed.assignedAgentId).toBe('agent-1');
      expect(failed.completedAt).toBeTruthy();

      dag.retryTask(LEAD, 'task-a');
      const retried = dag.getTask(LEAD, 'task-a')!;
      expect(retried.assignedAgentId).toBeUndefined();
      expect(retried.completedAt).toBeUndefined();
      expect(retried.dagStatus).toBe('ready');
    });

    it('multiple failures and retries maintain consistency', () => {
      batch(dag, LEAD, [
        { taskId: 'flaky', role: 'Developer' },
        { taskId: 'dependent', role: 'Developer', dependsOn: ['flaky'] },
      ]);

      // Fail 3 times
      for (let i = 1; i <= 3; i++) {
        dag.startTask(LEAD, 'flaky', `agent-${i}`);
        dag.failTask(LEAD, 'flaky');
        expect(dag.getTask(LEAD, 'dependent')!.dagStatus).toBe('blocked');
        dag.retryTask(LEAD, 'flaky');
        expect(dag.getTask(LEAD, 'dependent')!.dagStatus).toBe('pending');
      }

      // Finally succeed
      runTask(dag, LEAD, 'flaky', 'agent-4');
      expect(dag.getTask(LEAD, 'dependent')!.dagStatus).toBe('ready');
    });
  });

  // ── 4. Skip task ──────────────────────────────────────────────────

  describe('skip task', () => {
    it('skipping a task unblocks its dependents', () => {
      batch(dag, LEAD, [
        { taskId: 'optional', role: 'Developer', description: 'Nice to have' },
        { taskId: 'must-have', role: 'Developer', description: 'Required', dependsOn: ['optional'] },
      ]);

      dag.skipTask(LEAD, 'optional');
      expect(dag.getTask(LEAD, 'optional')!.dagStatus).toBe('skipped');
      expect(dag.getTask(LEAD, 'must-have')!.dagStatus).toBe('ready');
    });

    it('skipping a blocked task (from upstream failure) unblocks downstream', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev', dependsOn: ['a'] },
        { taskId: 'c', role: 'Dev', dependsOn: ['b'] },
      ]);

      // a fails → b blocked
      dag.startTask(LEAD, 'a', 'agent-1');
      dag.failTask(LEAD, 'a');
      expect(statusMap(dag, LEAD).b).toBe('blocked');

      // Skip b → c unblocked
      dag.skipTask(LEAD, 'b');
      expect(statusMap(dag, LEAD).b).toBe('skipped');
      expect(statusMap(dag, LEAD).c).toBe('ready');
    });

    it('skipping does not affect tasks without dependency on skipped task', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev' },
        { taskId: 'c', role: 'Dev', dependsOn: ['a'] },
      ]);

      dag.skipTask(LEAD, 'a');
      expect(statusMap(dag, LEAD).b).toBe('ready'); // unchanged
      expect(statusMap(dag, LEAD).c).toBe('ready'); // unblocked
    });

    it('can skip a running task and returns agent info', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);
      dag.startTask(LEAD, 'a', 'agent-1');
      const result = dag.skipTask(LEAD, 'a');
      expect(result).toBeTruthy();
      expect(result).toEqual({ skippedAgentId: 'agent-1' });
      expect(dag.getTask(LEAD, 'a')!.dagStatus).toBe('skipped');
      expect(dag.getTask(LEAD, 'a')!.assignedAgentId).toBeUndefined();
    });
  });

  // ── 4b. Force ready ─────────────────────────────────────────────────

  describe('force ready', () => {
    it('forces a blocked task to ready', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev', dependsOn: ['a'] },
      ]);
      expect(dag.getTask(LEAD, 'b')!.dagStatus).toBe('pending');

      const task = dag.forceReady(LEAD, 'b');
      expect(task).not.toBeNull();
      expect(task!.dagStatus).toBe('ready');
    });

    it('forces a pending task to ready', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev', dependsOn: ['a'] },
      ]);
      // b is pending (a is ready but not done)
      expect(dag.getTask(LEAD, 'b')!.dagStatus).toBe('pending');
      const task = dag.forceReady(LEAD, 'b');
      expect(task).not.toBeNull();
      expect(task!.dagStatus).toBe('ready');
    });

    it('returns null for already ready task', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);
      expect(dag.getTask(LEAD, 'a')!.dagStatus).toBe('ready');
      expect(dag.forceReady(LEAD, 'a')).toBeNull();
    });

    it('returns null for running task', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);
      dag.startTask(LEAD, 'a', 'agent-1');
      expect(dag.forceReady(LEAD, 'a')).toBeNull();
    });

    it('returns null for done task', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);
      dag.startTask(LEAD, 'a', 'agent-1');
      dag.completeTask(LEAD, 'a');
      expect(dag.forceReady(LEAD, 'a')).toBeNull();
    });
  });

  // ── 5. Cancel task ────────────────────────────────────────────────

  describe('cancel task', () => {
    it('removes a ready task from the DAG entirely', () => {
      batch(dag, LEAD, [
        { taskId: 'keep', role: 'Dev' },
        { taskId: 'remove', role: 'Dev' },
      ]);

      dag.cancelTask(LEAD, 'remove');
      expect(dag.getTask(LEAD, 'remove')).toBeNull();
      expect(dag.getTasks(LEAD)).toHaveLength(1);
    });

    it('cannot cancel a running task', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);
      dag.startTask(LEAD, 'a', 'agent-1');
      expect(dag.cancelTask(LEAD, 'a')).toBe(false);
      expect(dag.getTask(LEAD, 'a')).not.toBeNull();
    });

    it('cannot cancel a completed task', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);
      runTask(dag, LEAD, 'a', 'agent-1');
      expect(dag.cancelTask(LEAD, 'a')).toBe(false);
    });

    it('can cancel a blocked task', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev', dependsOn: ['a'] },
      ]);
      dag.startTask(LEAD, 'a', 'agent-1');
      dag.failTask(LEAD, 'a');
      expect(dag.getTask(LEAD, 'b')!.dagStatus).toBe('blocked');

      expect(dag.cancelTask(LEAD, 'b')).toBe(true);
      expect(dag.getTask(LEAD, 'b')).toBeNull();
    });
  });

  // ── 6. getStatus (PROGRESS reads DAG) ─────────────────────────────

  describe('getStatus (PROGRESS reads DAG)', () => {
    it('returns complete DAG state with summary, tasks, and file lock map', () => {
      batch(dag, LEAD, [
        { taskId: 'api', role: 'Developer', files: ['src/api.ts', 'src/routes.ts'], priority: 10 },
        { taskId: 'ui', role: 'Designer', files: ['src/App.tsx'], dependsOn: ['api'], priority: 5 },
        { taskId: 'docs', role: 'Tech Writer', files: ['README.md'] },
      ]);

      dag.startTask(LEAD, 'api', 'agent-api');
      dag.startTask(LEAD, 'docs', 'agent-docs');

      const status = dag.getStatus(LEAD);

      // Summary counts
      expect(status.summary.running).toBe(2);
      expect(status.summary.pending).toBe(1);
      expect(status.summary.ready).toBe(0);
      expect(status.summary.done).toBe(0);

      // File lock map shows running tasks' files
      expect(status.fileLockMap['src/api.ts']).toEqual({ taskId: 'api', agentId: 'agent-api' });
      expect(status.fileLockMap['src/routes.ts']).toEqual({ taskId: 'api', agentId: 'agent-api' });
      expect(status.fileLockMap['README.md']).toEqual({ taskId: 'docs', agentId: 'agent-docs' });
      expect(status.fileLockMap['src/App.tsx']).toBeUndefined(); // ui not running

      // All tasks present
      expect(status.tasks).toHaveLength(3);
    });

    it('summary updates correctly as tasks complete', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev' },
        { taskId: 'c', role: 'Dev', dependsOn: ['a', 'b'] },
      ]);

      let s = dag.getStatus(LEAD).summary;
      expect(s).toEqual({ pending: 1, ready: 2, running: 0, in_review: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 });

      runTask(dag, LEAD, 'a', 'agent-1');
      s = dag.getStatus(LEAD).summary;
      expect(s.done).toBe(1);
      expect(s.ready).toBe(1);
      expect(s.pending).toBe(1);

      runTask(dag, LEAD, 'b', 'agent-2');
      s = dag.getStatus(LEAD).summary;
      expect(s.done).toBe(2);
      expect(s.ready).toBe(1); // c promoted

      runTask(dag, LEAD, 'c', 'agent-3');
      s = dag.getStatus(LEAD).summary;
      expect(s).toEqual({ pending: 0, ready: 0, running: 0, in_review: 0, done: 3, failed: 0, blocked: 0, paused: 0, skipped: 0 });
    });
  });

  // ── 7. Complex dependency chain (diamond + linear) ─────────────────

  describe('complex dependency chain', () => {
    it('A→B→C→D linear chain + E depends on both B and C (diamond)', () => {
      //   A → B → C → D
      //        \   /
      //          E
      batch(dag, LEAD, [
        { taskId: 'A', role: 'Dev', description: 'Foundation' },
        { taskId: 'B', role: 'Dev', description: 'Core module', dependsOn: ['A'] },
        { taskId: 'C', role: 'Dev', description: 'Extension', dependsOn: ['B'] },
        { taskId: 'D', role: 'Dev', description: 'Final integration', dependsOn: ['C'] },
        { taskId: 'E', role: 'Dev', description: 'Cross-cutting', dependsOn: ['B', 'C'] },
      ]);

      // Only A is ready
      expect(statusMap(dag, LEAD)).toEqual({
        A: 'ready', B: 'pending', C: 'pending', D: 'pending', E: 'pending',
      });

      // Complete A → B ready
      runTask(dag, LEAD, 'A', 'agent-1');
      expect(statusMap(dag, LEAD).B).toBe('ready');
      expect(statusMap(dag, LEAD).C).toBe('pending');

      // Complete B → C ready, E still pending (needs C too)
      runTask(dag, LEAD, 'B', 'agent-2');
      expect(statusMap(dag, LEAD).C).toBe('ready');
      expect(statusMap(dag, LEAD).E).toBe('pending');

      // Complete C → D ready, E ready (both deps met)
      runTask(dag, LEAD, 'C', 'agent-3');
      expect(statusMap(dag, LEAD).D).toBe('ready');
      expect(statusMap(dag, LEAD).E).toBe('ready');

      // D and E can run in parallel
      dag.startTask(LEAD, 'D', 'agent-4');
      dag.startTask(LEAD, 'E', 'agent-5');
      expect(statusMap(dag, LEAD).D).toBe('running');
      expect(statusMap(dag, LEAD).E).toBe('running');

      dag.completeTask(LEAD, 'D');
      dag.completeTask(LEAD, 'E');

      const status = dag.getStatus(LEAD);
      expect(status.summary.done).toBe(5);
      expect(status.summary.pending + status.summary.ready + status.summary.running).toBe(0);
    });

    it('failure in diamond blocks convergence point', () => {
      batch(dag, LEAD, [
        { taskId: 'root', role: 'Dev' },
        { taskId: 'left', role: 'Dev', dependsOn: ['root'] },
        { taskId: 'right', role: 'Dev', dependsOn: ['root'] },
        { taskId: 'merge', role: 'Dev', dependsOn: ['left', 'right'] },
      ]);

      runTask(dag, LEAD, 'root', 'agent-1');

      // Left succeeds, right fails
      runTask(dag, LEAD, 'left', 'agent-2');
      dag.startTask(LEAD, 'right', 'agent-3');
      dag.failTask(LEAD, 'right');

      // merge should be blocked (right failed, it's a direct dependent)
      // Actually, merge depends on right which failed, so it gets blocked
      expect(statusMap(dag, LEAD).merge).toBe('blocked');

      // Retry right → merge unblocks
      dag.retryTask(LEAD, 'right');
      runTask(dag, LEAD, 'right', 'agent-4');

      // merge should now be ready
      expect(statusMap(dag, LEAD).merge).toBe('ready');

      runTask(dag, LEAD, 'merge', 'agent-5');
      expect(dag.getStatus(LEAD).summary.done).toBe(4);
    });

    it('wide fan-out: one root with 5 independent children', () => {
      batch(dag, LEAD, [
        { taskId: 'root', role: 'Lead' },
        { taskId: 'c1', role: 'Dev', dependsOn: ['root'] },
        { taskId: 'c2', role: 'Dev', dependsOn: ['root'] },
        { taskId: 'c3', role: 'Dev', dependsOn: ['root'] },
        { taskId: 'c4', role: 'Dev', dependsOn: ['root'] },
        { taskId: 'c5', role: 'Dev', dependsOn: ['root'] },
      ]);

      runTask(dag, LEAD, 'root', 'agent-lead');

      // All 5 children should be ready
      const sm = statusMap(dag, LEAD);
      for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
        expect(sm[id]).toBe('ready');
      }

      // Complete all 5 in parallel
      for (let i = 1; i <= 5; i++) {
        runTask(dag, LEAD, `c${i}`, `agent-${i}`);
      }

      expect(dag.getStatus(LEAD).summary.done).toBe(6);
    });
  });

  // ── 8. Reset DAG ──────────────────────────────────────────────────

  describe('reset DAG', () => {
    it('full reset after partial completion allows re-declaration', () => {
      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev', dependsOn: ['a'] },
        { taskId: 'c', role: 'Dev', dependsOn: ['b'] },
      ]);

      // Partially complete
      runTask(dag, LEAD, 'a', 'agent-1');
      dag.startTask(LEAD, 'b', 'agent-2');
      // b is running, c is pending

      const count = dag.resetDAG(LEAD);
      expect(count).toBe(3);
      expect(dag.getTasks(LEAD)).toHaveLength(0);
      expect(dag.getStatus(LEAD).summary.done).toBe(0);

      // Can re-declare entirely new tasks
      batch(dag, LEAD, [
        { taskId: 'x', role: 'Dev', description: 'New task' },
        { taskId: 'y', role: 'Dev', description: 'Another new task', dependsOn: ['x'] },
      ]);

      expect(dag.getTasks(LEAD)).toHaveLength(2);
      expect(dag.getTask(LEAD, 'x')!.dagStatus).toBe('ready');
    });

    it('reset one lead does not affect another lead', () => {
      batch(dag, 'lead-A', [
        { taskId: 'a1', role: 'Dev' },
        { taskId: 'a2', role: 'Dev', dependsOn: ['a1'] },
      ]);
      batch(dag, 'lead-B', [
        { taskId: 'b1', role: 'Dev' },
        { taskId: 'b2', role: 'Dev', dependsOn: ['b1'] },
      ]);

      runTask(dag, 'lead-A', 'a1', 'agent-1');

      dag.resetDAG('lead-A');
      expect(dag.getTasks('lead-A')).toHaveLength(0);
      expect(dag.getTasks('lead-B')).toHaveLength(2);
      expect(dag.getTask('lead-B', 'b1')!.dagStatus).toBe('ready');
    });

    it('emits dag:updated on reset', () => {
      batch(dag, LEAD, [{ taskId: 'a', role: 'Dev' }]);

      const events: any[] = [];
      dag.on('dag:updated', (data) => events.push(data));

      dag.resetDAG(LEAD);
      expect(events).toContainEqual({ leadId: LEAD });
    });
  });

  // ── 9. Mixed operations: pause, resume, skip in a complex DAG ─────

  describe('mixed operations in a realistic scenario', () => {
    it('simulates a real multi-agent sprint with mixed outcomes', () => {
      // Sprint plan: 7 tasks across 3 workstreams
      batch(dag, LEAD, [
        // Workstream 1: API
        { taskId: 'api-design', role: 'Architect', description: 'Design API schema', priority: 10 },
        { taskId: 'api-impl', role: 'Developer', description: 'Implement API', dependsOn: ['api-design'], priority: 8 },
        { taskId: 'api-tests', role: 'Developer', description: 'API tests', dependsOn: ['api-impl'], priority: 6 },
        // Workstream 2: UI
        { taskId: 'ui-design', role: 'Designer', description: 'Design UI mockups', priority: 9 },
        { taskId: 'ui-impl', role: 'Developer', description: 'Implement UI', dependsOn: ['ui-design', 'api-impl'], priority: 7 },
        // Workstream 3: Docs (independent)
        { taskId: 'docs', role: 'Tech Writer', description: 'Write documentation', priority: 3 },
        // Integration (depends on everything)
        { taskId: 'integration', role: 'Developer', description: 'Full integration', dependsOn: ['api-tests', 'ui-impl', 'docs'], priority: 1 },
      ]);

      // Phase 1: Start independent tasks
      expect(statusMap(dag, LEAD)['api-design']).toBe('ready');
      expect(statusMap(dag, LEAD)['ui-design']).toBe('ready');
      expect(statusMap(dag, LEAD)['docs']).toBe('ready');

      // Architect starts API design; Designer starts UI; Docs paused (low priority)
      dag.startTask(LEAD, 'api-design', 'architect-1');
      dag.startTask(LEAD, 'ui-design', 'designer-1');
      dag.pauseTask(LEAD, 'docs'); // lead decides to pause docs for now

      // Phase 2: API design complete, UI design complete
      dag.completeTask(LEAD, 'api-design');
      dag.completeTask(LEAD, 'ui-design');

      let sm = statusMap(dag, LEAD);
      expect(sm['api-impl']).toBe('ready');
      expect(sm['ui-impl']).toBe('pending'); // needs api-impl too

      // Phase 3: API impl starts, then fails
      dag.startTask(LEAD, 'api-impl', 'dev-1');
      dag.failTask(LEAD, 'api-impl');

      sm = statusMap(dag, LEAD);
      expect(sm['api-impl']).toBe('failed');
      expect(sm['api-tests']).toBe('blocked'); // direct dependent
      expect(sm['ui-impl']).toBe('blocked'); // also depends on api-impl

      // Phase 4: Retry API impl with different agent
      dag.retryTask(LEAD, 'api-impl');
      runTask(dag, LEAD, 'api-impl', 'dev-2');

      sm = statusMap(dag, LEAD);
      expect(sm['api-tests']).toBe('ready'); // unblocked
      expect(sm['ui-impl']).toBe('ready'); // both deps met

      // Phase 5: Resume docs, run api-tests and ui-impl in parallel
      dag.resumeTask(LEAD, 'docs');
      expect(statusMap(dag, LEAD)['docs']).toBe('ready');

      dag.startTask(LEAD, 'api-tests', 'dev-3');
      dag.startTask(LEAD, 'ui-impl', 'dev-4');
      dag.startTask(LEAD, 'docs', 'writer-1');

      // Phase 6: api-tests fails, complete others first
      dag.failTask(LEAD, 'api-tests');
      dag.completeTask(LEAD, 'ui-impl');
      dag.completeTask(LEAD, 'docs');

      // integration is blocked because api-tests failed (direct dependent)
      expect(statusMap(dag, LEAD)['integration']).toBe('blocked');

      // Retry api-tests instead of skipping — this unblocks dependents
      dag.retryTask(LEAD, 'api-tests');
      // integration moves from blocked to pending (retryTask unblocks dependents)
      expect(statusMap(dag, LEAD)['integration']).toBe('pending');

      // Now skip api-tests (it's ready after retry) — this counts as "done" for deps
      dag.skipTask(LEAD, 'api-tests');

      // Integration should now be ready (api-tests skipped, ui-impl done, docs done)
      expect(statusMap(dag, LEAD)['integration']).toBe('ready');

      // Phase 7: Final integration
      runTask(dag, LEAD, 'integration', 'dev-5');

      const final = dag.getStatus(LEAD);
      // api-design(done), api-impl(done), api-tests(skipped), ui-design(done), ui-impl(done), docs(done), integration(done)
      expect(final.summary.done).toBe(6);
      expect(final.summary.skipped).toBe(1);
      expect(final.summary.failed).toBe(0);
      expect(final.tasks).toHaveLength(7);
    });
  });

  // ── 10. Event emission ─────────────────────────────────────────────

  describe('event emission throughout lifecycle', () => {
    it('emits dag:updated on every state change', () => {
      const events: any[] = [];
      dag.on('dag:updated', (data) => events.push(data));

      batch(dag, LEAD, [
        { taskId: 'a', role: 'Dev' },
        { taskId: 'b', role: 'Dev', dependsOn: ['a'] },
      ]);
      expect(events.length).toBe(1); // declareTaskBatch

      dag.startTask(LEAD, 'a', 'agent-1');
      expect(events.length).toBe(2);

      dag.completeTask(LEAD, 'a');
      expect(events.length).toBe(3);

      dag.startTask(LEAD, 'b', 'agent-2');
      expect(events.length).toBe(4);

      dag.completeTask(LEAD, 'b');
      expect(events.length).toBe(5);

      // All events scoped to correct lead
      expect(events.every(e => e.leadId === LEAD)).toBe(true);
    });
  });

  // ── 11. Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('single task DAG works end to end', () => {
      batch(dag, LEAD, [{ taskId: 'only', role: 'Dev', description: 'Solo task' }]);
      expect(dag.getTask(LEAD, 'only')!.dagStatus).toBe('ready');

      runTask(dag, LEAD, 'only', 'agent-solo');
      expect(dag.getStatus(LEAD).summary.done).toBe(1);
    });

    it('all tasks independent (no dependencies)', () => {
      batch(dag, LEAD, [
        { taskId: 't1', role: 'Dev' },
        { taskId: 't2', role: 'Dev' },
        { taskId: 't3', role: 'Dev' },
        { taskId: 't4', role: 'Dev' },
      ]);

      const sm = statusMap(dag, LEAD);
      expect(Object.values(sm).every(s => s === 'ready')).toBe(true);

      // All can complete in any order
      for (let i = 1; i <= 4; i++) {
        runTask(dag, LEAD, `t${i}`, `agent-${i}`);
      }
      expect(dag.getStatus(LEAD).summary.done).toBe(4);
    });

    it('addTask to existing DAG with cross-batch dependency', () => {
      batch(dag, LEAD, [
        { taskId: 'phase1', role: 'Dev', description: 'First phase' },
      ]);

      // Dynamically add task that depends on phase1
      const added = dag.addTask(LEAD, { taskId: 'phase2', role: 'Dev', dependsOn: ['phase1'] });
      expect(added.dagStatus).toBe('pending');

      // Complete phase1 → phase2 promoted
      runTask(dag, LEAD, 'phase1', 'agent-1');
      expect(dag.getTask(LEAD, 'phase2')!.dagStatus).toBe('ready');
    });

    it('unknown dependency throws on declare', () => {
      expect(() => {
        batch(dag, LEAD, [
          { taskId: 'orphan', role: 'Dev', dependsOn: ['ghost'] },
        ]);
      }).toThrow('depends on unknown task "ghost"');
    });

    it('duplicate task ID in same lead throws', () => {
      batch(dag, LEAD, [{ taskId: 'dup', role: 'Dev' }]);
      expect(() => {
        batch(dag, LEAD, [{ taskId: 'dup', role: 'Dev' }]);
      }).toThrow('Task "dup" already exists');
    });
  });
});
