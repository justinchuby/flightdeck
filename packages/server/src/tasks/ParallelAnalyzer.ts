import type { TaskDAG, DagTask } from './TaskDAG.js';

export interface ExecutionSlot {
  taskId: string;
  start: number;
  end: number;
  agentId?: string;
}

export interface ParallelAnalysis {
  totalTasks: number;
  maxParallelism: number;    // theoretical max concurrent tasks (widest level in DAG)
  actualParallelism: number; // observed avg concurrent tasks
  bottlenecks: Bottleneck[];
  suggestions: string[];
  criticalPathLength: number;
  estimatedSpeedup: number;  // theoretical/actual ratio
}

export interface Bottleneck {
  taskId: string;
  description: string;
  blockedCount: number; // how many tasks were waiting on this
  duration: number;
}

function emptyAnalysis(): ParallelAnalysis {
  return {
    totalTasks: 0,
    maxParallelism: 0,
    actualParallelism: 0,
    bottlenecks: [],
    suggestions: [],
    criticalPathLength: 0,
    estimatedSpeedup: 1,
  };
}

export class ParallelAnalyzer {
  constructor(private taskDAG: TaskDAG) {}

  analyze(): ParallelAnalysis {
    const tasks = this.taskDAG.getAll();
    if (tasks.length === 0) return emptyAnalysis();

    // Calculate theoretical max parallelism (max width of DAG)
    const levels = this.topologicalLevels(tasks);
    const maxParallelism = Math.max(...levels.map(l => l.length), 1);

    // Find critical path (longest chain through the DAG)
    const criticalPath = this.findCriticalPath(tasks);

    // Find bottlenecks (tasks depended on by the most others)
    const bottlenecks = this.findBottlenecks(tasks);

    // Generate actionable suggestions
    const suggestions: string[] = [];
    const runningCount = tasks.filter(t => t.dagStatus === 'running').length;
    if (maxParallelism > 3 && runningCount <= 1) {
      suggestions.push(
        `DAG has ${maxParallelism}-wide parallelism but only 1 agent active. Spawn more agents.`,
      );
    }
    for (const bn of bottlenecks) {
      suggestions.push(
        `Task "${bn.description}" blocks ${bn.blockedCount} downstream tasks. Prioritize it.`,
      );
    }
    if (criticalPath.length > tasks.length / 2) {
      suggestions.push('Critical path is >50% of total tasks — consider breaking sequential dependencies.');
    }

    return {
      totalTasks: tasks.length,
      maxParallelism,
      actualParallelism: this.calculateActualParallelism(tasks),
      bottlenecks,
      suggestions,
      criticalPathLength: criticalPath.length,
      estimatedSpeedup: criticalPath.length > 0 ? tasks.length / criticalPath.length : 1,
    };
  }

  /** Group tasks by dependency depth (topological level) */
  private topologicalLevels(tasks: DagTask[]): DagTask[][] {
    const levels: DagTask[][] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const depths = new Map<string, number>();

    const getDepth = (id: string): number => {
      if (depths.has(id)) return depths.get(id)!;
      const task = taskMap.get(id);
      if (!task || !task.dependsOn?.length) {
        depths.set(id, 0);
        return 0;
      }
      const maxDep = Math.max(...task.dependsOn.map(d => getDepth(d)));
      depths.set(id, maxDep + 1);
      return maxDep + 1;
    };

    for (const task of tasks) getDepth(task.id);

    for (const [id, depth] of depths) {
      while (levels.length <= depth) levels.push([]);
      levels[depth].push(taskMap.get(id)!);
    }
    return levels;
  }

  /** Find the longest path through the DAG (critical path) */
  private findCriticalPath(tasks: DagTask[]): string[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    let longestPath: string[] = [];

    const dfs = (id: string, path: string[]): void => {
      path.push(id);
      if (path.length > longestPath.length) longestPath = [...path];
      // Find tasks that depend on this one
      const children = tasks.filter(t => t.dependsOn?.includes(id));
      for (const child of children) dfs(child.id, path);
      path.pop();
    };

    // Start DFS from root tasks (no dependencies)
    const roots = tasks.filter(t => !t.dependsOn?.length);
    for (const root of roots) dfs(root.id, []);

    // Edge case: if all tasks have dependencies (cycle or orphan), start from any task
    if (longestPath.length === 0 && tasks.length > 0) {
      longestPath = [tasks[0].id];
    }

    return longestPath;
  }

  /** Identify tasks that block 2+ other tasks — serialization bottlenecks */
  private findBottlenecks(tasks: DagTask[]): Bottleneck[] {
    const blockCounts = new Map<string, number>();
    for (const task of tasks) {
      for (const dep of task.dependsOn ?? []) {
        blockCounts.set(dep, (blockCounts.get(dep) ?? 0) + 1);
      }
    }

    return [...blockCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const task = tasks.find(t => t.id === id);
        return {
          taskId: id,
          description: task?.description ?? id,
          blockedCount: count,
          duration: 0,
        };
      });
  }

  /** Estimate average actual parallelism from task history */
  private calculateActualParallelism(tasks: DagTask[]): number {
    const active = tasks.filter(t => t.dagStatus === 'running' || t.dagStatus === 'done');
    if (active.length === 0) return 1;
    const done = tasks.filter(t => t.dagStatus === 'done').length;
    return Math.max(1, Math.round(active.length / Math.max(1, done)));
  }
}
