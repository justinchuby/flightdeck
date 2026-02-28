import { describe, it, expect, beforeEach } from 'vitest';
import { ParallelAnalyzer } from '../tasks/ParallelAnalyzer.js';
import type { TaskDAG, DagTask } from '../tasks/TaskDAG.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<DagTask> & { id: string }): DagTask {
  return {
    leadId: 'lead-1',
    role: 'Developer',
    description: overrides.description ?? `Task ${overrides.id}`,
    files: [],
    dependsOn: [],
    dagStatus: 'pending',
    priority: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockDAG(tasks: DagTask[]): TaskDAG {
  return { getAll: () => tasks } as unknown as TaskDAG;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ParallelAnalyzer', () => {
  describe('empty DAG', () => {
    it('returns zero/empty analysis for no tasks', () => {
      const analyzer = new ParallelAnalyzer(mockDAG([]));
      const result = analyzer.analyze();
      expect(result.totalTasks).toBe(0);
      expect(result.maxParallelism).toBe(0);
      expect(result.actualParallelism).toBe(0);
      expect(result.bottlenecks).toEqual([]);
      expect(result.suggestions).toEqual([]);
      expect(result.criticalPathLength).toBe(0);
      expect(result.estimatedSpeedup).toBe(1);
    });
  });

  describe('linear chain (A → B → C)', () => {
    let analyzer: ParallelAnalyzer;
    const tasks = [
      makeTask({ id: 'A', dagStatus: 'done' }),
      makeTask({ id: 'B', dependsOn: ['A'], dagStatus: 'done' }),
      makeTask({ id: 'C', dependsOn: ['B'], dagStatus: 'running' }),
    ];

    beforeEach(() => {
      analyzer = new ParallelAnalyzer(mockDAG(tasks));
    });

    it('reports totalTasks = 3', () => {
      expect(analyzer.analyze().totalTasks).toBe(3);
    });

    it('maxParallelism = 1 for a fully sequential chain', () => {
      expect(analyzer.analyze().maxParallelism).toBe(1);
    });

    it('criticalPathLength equals the chain length', () => {
      expect(analyzer.analyze().criticalPathLength).toBe(3);
    });

    it('estimatedSpeedup = 1 when criticalPath = totalTasks', () => {
      // 3 tasks / 3 critical path = 1
      expect(analyzer.analyze().estimatedSpeedup).toBeCloseTo(1, 1);
    });

    it('suggests breaking sequential dependencies when path > 50%', () => {
      const result = analyzer.analyze();
      expect(result.suggestions.some(s => s.includes('sequential dependencies'))).toBe(true);
    });
  });

  describe('wide parallel DAG (4 independent tasks)', () => {
    const tasks = [
      makeTask({ id: 'T1', dagStatus: 'pending' }),
      makeTask({ id: 'T2', dagStatus: 'pending' }),
      makeTask({ id: 'T3', dagStatus: 'pending' }),
      makeTask({ id: 'T4', dagStatus: 'pending' }),
    ];

    it('maxParallelism = 4 for fully independent tasks', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      expect(analyzer.analyze().maxParallelism).toBe(4);
    });

    it('criticalPathLength = 1 (single level)', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      expect(analyzer.analyze().criticalPathLength).toBe(1);
    });

    it('estimatedSpeedup = 4 for 4 parallel tasks with path of 1', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      expect(analyzer.analyze().estimatedSpeedup).toBeCloseTo(4, 1);
    });

    it('suggests spawning more agents when parallelism > 3 but only 1 active', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      const result = analyzer.analyze();
      expect(result.suggestions.some(s => s.includes('Spawn more agents'))).toBe(true);
    });

    it('no spawn suggestion when enough agents are running', () => {
      const runningTasks = tasks.map(t => makeTask({ ...t, dagStatus: 'running' }));
      const analyzer = new ParallelAnalyzer(mockDAG(runningTasks));
      const result = analyzer.analyze();
      expect(result.suggestions.some(s => s.includes('Spawn more agents'))).toBe(false);
    });
  });

  describe('bottleneck detection', () => {
    // Diamond: A → [B, C, D] all depend on A
    const tasks = [
      makeTask({ id: 'A', description: 'Root blocker', dagStatus: 'running' }),
      makeTask({ id: 'B', dependsOn: ['A'], dagStatus: 'pending' }),
      makeTask({ id: 'C', dependsOn: ['A'], dagStatus: 'pending' }),
      makeTask({ id: 'D', dependsOn: ['A'], dagStatus: 'pending' }),
    ];

    it('identifies A as a bottleneck blocking 3 tasks', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      const result = analyzer.analyze();
      const bottleneck = result.bottlenecks.find(b => b.taskId === 'A');
      expect(bottleneck).toBeDefined();
      expect(bottleneck!.blockedCount).toBe(3);
    });

    it('includes bottleneck description in suggestion', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      const result = analyzer.analyze();
      expect(result.suggestions.some(s => s.includes('Root blocker') && s.includes('3 downstream'))).toBe(true);
    });

    it('ignores tasks that block only 1 other task', () => {
      const simpleTasks = [
        makeTask({ id: 'X' }),
        makeTask({ id: 'Y', dependsOn: ['X'] }),
      ];
      const analyzer = new ParallelAnalyzer(mockDAG(simpleTasks));
      expect(analyzer.analyze().bottlenecks).toHaveLength(0);
    });
  });

  describe('critical path accuracy', () => {
    // A → B → D (path length 3) vs A → C (path length 2)
    const tasks = [
      makeTask({ id: 'A' }),
      makeTask({ id: 'B', dependsOn: ['A'] }),
      makeTask({ id: 'C', dependsOn: ['A'] }),
      makeTask({ id: 'D', dependsOn: ['B'] }),
    ];

    it('returns critical path length of 3', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      expect(analyzer.analyze().criticalPathLength).toBe(3);
    });

    it('maxParallelism is 2 (A→B and A→C run concurrently)', () => {
      const analyzer = new ParallelAnalyzer(mockDAG(tasks));
      expect(analyzer.analyze().maxParallelism).toBe(2);
    });
  });
});
