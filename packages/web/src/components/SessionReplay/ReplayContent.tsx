import { Users, CheckCircle2, Clock, AlertTriangle, FileText, Activity } from 'lucide-react';
import type {
  ReplayWorldState,
  ReplayAgentState,
  ReplayDagTask,
  ReplayDecision,
  ReplayActivityEntry,
} from '../../hooks/useSessionReplay';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

// ── Status colors ────────────────────────────────────────────────────

const AGENT_STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-400',
  idle: 'bg-yellow-400',
  completed: 'bg-blue-400',
  failed: 'bg-red-400',
  terminated: 'bg-gray-400',
};

const TASK_STATUS_ICONS: Record<string, string> = {
  done: '✅',
  running: '🔄',
  ready: '🟢',
  pending: '⏳',
  failed: '❌',
  blocked: '🚫',
  paused: '⏸️',
  skipped: '⏭️',
};

const ACTIVITY_ICONS: Record<string, string> = {
  progress_update: '📊',
  task_completed: '✅',
  task_started: '▶️',
  decision_made: '⚖️',
  delegated: '📋',
  sub_agent_spawned: '🤖',
  file_edit: '📝',
  error: '🔴',
  agent_terminated: '💀',
  commit: '📦',
};

// ── Sub-components ───────────────────────────────────────────────────

function AgentRosterPanel({ agents }: { agents: ReplayAgentState[] }) {
  if (agents.length === 0) {
    return (
      <div className="text-xs text-th-text-muted text-center py-4">
        No agents at this point in time
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded bg-th-bg-alt/50"
          data-testid="replay-agent"
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${AGENT_STATUS_COLORS[agent.status] ?? 'bg-gray-400'}`}
          />
          <span className="text-xs font-medium text-th-text-alt truncate flex-1">
            {agent.role}
          </span>
          <span className="text-[10px] text-th-text-muted font-mono">
            {agent.id.slice(0, 8)}
          </span>
          {agent.contextUsedPct != null && (
            <div className="w-12 h-1 bg-th-bg-alt rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${agent.contextUsedPct > 80 ? 'bg-red-400' : 'bg-accent/60'}`}
                style={{ width: `${Math.min(100, agent.contextUsedPct)}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TaskDagPanel({ tasks }: { tasks: ReplayDagTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="text-xs text-th-text-muted text-center py-4">
        No tasks declared
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-start gap-2 px-2 py-1.5 rounded bg-th-bg-alt/50"
          data-testid="replay-task"
        >
          <span className="text-xs shrink-0 mt-0.5">
            {TASK_STATUS_ICONS[task.dagStatus] ?? '⏳'}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-th-text-alt block truncate">{task.id}</span>
            {task.description && (
              <span className="text-[10px] text-th-text-muted block truncate">
                {task.description}
              </span>
            )}
          </div>
          {task.assignedTo && (
            <span className="text-[10px] text-th-text-muted font-mono shrink-0">
              → {task.assignedTo.slice(0, 8)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function DecisionPanel({ decisions }: { decisions: ReplayDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <div className="space-y-1">
      {decisions.map((d) => (
        <div
          key={d.id}
          className="flex items-start gap-2 px-2 py-1.5 rounded bg-th-bg-alt/50"
          data-testid="replay-decision"
        >
          <span className="text-xs shrink-0 mt-0.5">
            {d.status === 'confirmed' ? '✅' : d.status === 'rejected' ? '❌' : '⚖️'}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-th-text-alt block truncate">{d.summary}</span>
            {d.agentRole && (
              <span className="text-[10px] text-th-text-muted">by {d.agentRole}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed({ entries }: { entries: ReplayActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-xs text-th-text-muted text-center py-4">
        No activity at this point
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {entries.slice(0, 20).map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-2 px-2 py-1 text-xs"
          data-testid="replay-activity"
        >
          <span className="shrink-0 mt-0.5">
            {ACTIVITY_ICONS[entry.actionType] ?? '📎'}
          </span>
          <span className="text-th-text-alt truncate flex-1">{entry.summary}</span>
          <span className="text-[10px] text-th-text-muted shrink-0">
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export interface ReplayContentProps {
  worldState: ReplayWorldState | null;
  loading?: boolean;
}

export function ReplayContent({ worldState, loading }: ReplayContentProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="replay-content-loading">
        <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!worldState) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8" data-testid="replay-content-empty">
        <div>
          <p className="text-3xl mb-2">📼</p>
          <p className="text-sm text-th-text-muted">Scrub the timeline to see session state</p>
        </div>
      </div>
    );
  }

  const agents = worldState.agents ?? [];
  const tasks = worldState.dagTasks ?? [];
  const decisions = worldState.decisions ?? [];
  const activity = worldState.recentActivity ?? [];
  const runningCount = agents.filter(a => a.status === 'running').length;

  return (
    <div className="flex-1 overflow-hidden" data-testid="replay-content">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-th-border text-xs text-th-text-muted">
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          {agents.length} agents ({runningCount} running)
        </span>
        {worldState.totalTasks > 0 && (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {worldState.completedTasks}/{worldState.totalTasks} tasks
          </span>
        )}
        {worldState.pendingDecisions > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <AlertTriangle className="w-3 h-3" />
            {worldState.pendingDecisions} pending decisions
          </span>
        )}
        <span className="flex items-center gap-1 ml-auto">
          <Clock className="w-3 h-3" />
          {new Date(worldState.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* 3-column content */}
      <div className="grid grid-cols-3 gap-0 h-[calc(100%-2.5rem)] overflow-hidden">
        {/* Left: Agent Roster */}
        <div className="border-r border-th-border overflow-y-auto p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Users className="w-3.5 h-3.5 text-th-text-muted" />
            <h3 className="text-xs font-medium text-th-text-alt">Agents</h3>
          </div>
          <AgentRosterPanel agents={agents} />
        </div>

        {/* Center: Activity Feed */}
        <div className="border-r border-th-border overflow-y-auto p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Activity className="w-3.5 h-3.5 text-th-text-muted" />
            <h3 className="text-xs font-medium text-th-text-alt">Activity</h3>
          </div>
          <ActivityFeed entries={activity} />
        </div>

        {/* Right: Tasks & Decisions */}
        <div className="overflow-y-auto p-3">
          {tasks.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="w-3.5 h-3.5 text-th-text-muted" />
                <h3 className="text-xs font-medium text-th-text-alt">Tasks</h3>
              </div>
              <TaskDagPanel tasks={tasks} />
            </>
          )}
          {decisions.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 mb-2 mt-3">
                <AlertTriangle className="w-3.5 h-3.5 text-th-text-muted" />
                <h3 className="text-xs font-medium text-th-text-alt">Decisions</h3>
              </div>
              <DecisionPanel decisions={decisions} />
            </>
          )}
          {tasks.length === 0 && decisions.length === 0 && (
            <div className="text-xs text-th-text-muted text-center py-4">
              No tasks or decisions at this point
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
