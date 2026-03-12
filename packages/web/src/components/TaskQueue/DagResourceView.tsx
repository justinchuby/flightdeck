/**
 * DagResourceView — Agent-centric resource utilization view.
 *
 * Groups DAG tasks by assigned agent, showing which agents are working on
 * what, their task statuses, and elapsed time. Unassigned tasks are shown
 * in a separate section.
 */
import { useMemo } from 'react';
import { Users, Clock, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { formatElapsed } from './dagCriticalPath';
import { EmptyState } from '../Shared';
import type { DagStatus, DagTask } from '../../types';
import { shortAgentId } from '../../utils/agentLabel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'text-gray-400 bg-gray-500/15', icon: <Clock size={10} />, label: 'Pending' },
  ready:   { color: 'text-green-400 bg-green-500/15', icon: <CheckCircle2 size={10} />, label: 'Ready' },
  running: { color: 'text-blue-400 bg-blue-500/15', icon: <Loader2 size={10} className="animate-spin" />, label: 'Running' },
  done:    { color: 'text-emerald-400 bg-emerald-500/15', icon: <CheckCircle2 size={10} />, label: 'Done' },
  failed:  { color: 'text-red-400 bg-red-500/15', icon: <AlertCircle size={10} />, label: 'Failed' },
  blocked: { color: 'text-amber-400 bg-amber-500/15', icon: <AlertCircle size={10} />, label: 'Blocked' },
  paused:  { color: 'text-yellow-400 bg-yellow-500/15', icon: <Clock size={10} />, label: 'Paused' },
  skipped: { color: 'text-gray-500 bg-gray-500/10', icon: null, label: 'Skipped' },
};

interface AgentGroup {
  agentId: string;
  tasks: DagTask[];
  runningCount: number;
  doneCount: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DagResourceViewProps {
  dagStatus: DagStatus | null;
}

export function DagResourceView({ dagStatus }: DagResourceViewProps) {
  const { agentGroups, unassigned } = useMemo(() => {
    if (!dagStatus) return { agentGroups: [], unassigned: [] };

    const byAgent = new Map<string, DagTask[]>();
    const unassigned: DagTask[] = [];

    for (const task of dagStatus.tasks) {
      if (task.assignedAgentId) {
        const list = byAgent.get(task.assignedAgentId) ?? [];
        list.push(task);
        byAgent.set(task.assignedAgentId, list);
      } else {
        unassigned.push(task);
      }
    }

    const agentGroups: AgentGroup[] = [...byAgent.entries()]
      .map(([agentId, tasks]) => ({
        agentId,
        tasks,
        runningCount: tasks.filter(t => t.dagStatus === 'running').length,
        doneCount: tasks.filter(t => t.dagStatus === 'done').length,
      }))
      .sort((a, b) => b.runningCount - a.runningCount || b.tasks.length - a.tasks.length);

    return { agentGroups, unassigned };
  }, [dagStatus]);

  if (!dagStatus || dagStatus.tasks.length === 0) {
    return <EmptyState icon="📋" title="No tasks to display" compact />;
  }

  const totalTasks = dagStatus.tasks.length;
  const doneTasks = dagStatus.summary.done;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-4 p-4" data-testid="dag-resource-view">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-cyan-400" />
          <span className="text-xs font-medium text-th-text">
            {agentGroups.length} agent{agentGroups.length !== 1 ? 's' : ''} assigned
          </span>
        </div>
        <span className="text-xs text-th-text-muted">
          {doneTasks}/{totalTasks} done ({pct}%)
        </span>
      </div>

      {/* Agent groups */}
      {agentGroups.map(({ agentId, tasks, runningCount, doneCount }) => (
        <div key={agentId} className="rounded-lg border border-th-border bg-th-bg-alt/30 overflow-hidden">
          {/* Agent header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-th-border/50 bg-th-bg-alt/50">
            <div className="flex items-center gap-2">
              <span className="text-blue-400 text-xs">🤖</span>
              <span className="text-xs font-mono text-th-text" data-testid="agent-id">
                {agentId.length > 16 ? shortAgentId(agentId) + '…' : agentId}
              </span>
              <span className="text-[10px] text-th-text-muted">
                {tasks[0]?.role}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              {runningCount > 0 && (
                <span className="text-blue-400 flex items-center gap-0.5">
                  <Loader2 size={9} className="animate-spin" /> {runningCount}
                </span>
              )}
              <span className="text-emerald-400">{doneCount}/{tasks.length}</span>
            </div>
          </div>

          {/* Task list */}
          <div className="divide-y divide-th-border/30">
            {tasks.map(task => {
              const badge = STATUS_BADGE[task.dagStatus] ?? STATUS_BADGE.pending;
              return (
                <div key={task.id} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-testid="resource-task-row">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.color}`}>
                    {badge.icon}
                    {badge.label}
                  </span>
                  <span className="text-th-text truncate flex-1" title={task.description || task.id}>
                    {task.title || task.id}
                  </span>
                  <span className="text-th-text-muted text-[10px] shrink-0">
                    {formatElapsed(task.createdAt, task.completedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Unassigned tasks */}
      {unassigned.length > 0 && (
        <div className="rounded-lg border border-th-border/50 bg-th-bg-alt/20 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-th-border/30 bg-th-bg-alt/30">
            <span className="text-xs text-th-text-muted font-medium">Unassigned</span>
            <span className="text-[10px] text-th-text-muted">{unassigned.length} task{unassigned.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-th-border/20">
            {unassigned.map(task => {
              const badge = STATUS_BADGE[task.dagStatus] ?? STATUS_BADGE.pending;
              return (
                <div key={task.id} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-testid="resource-task-row">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.color}`}>
                    {badge.icon}
                    {badge.label}
                  </span>
                  <span className="text-th-text-muted truncate flex-1">{task.title || task.id}</span>
                  <span className="text-th-text-muted text-[10px] shrink-0">{task.role}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
