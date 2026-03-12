import type { DagStatus, DagTask } from '../../types';
import { dagTaskText } from '../../utils/statusColors';
import { shortAgentId } from '../../utils/agentLabel';

const STATUS_CONFIG: Record<DagTask['dagStatus'], { icon: string; label: string; strikethrough?: boolean }> = {
  pending:    { icon: '⏳', label: 'pending' },
  ready:      { icon: '🟢', label: 'ready' },
  running:    { icon: '🔵', label: 'running' },
  in_review:  { icon: '🔍', label: 'in review' },
  done:       { icon: '✅', label: 'done' },
  failed:     { icon: '❌', label: 'failed' },
  blocked:    { icon: '🟠', label: 'blocked' },
  paused:     { icon: '⏸️', label: 'paused' },
  skipped:    { icon: '⏭️', label: 'skipped', strikethrough: true },
};

/** Badge pill for a task status */
function StatusBadge({ status }: { status: DagTask['dagStatus'] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${dagTaskText(status)} ${cfg.strikethrough ? 'line-through' : ''}`}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  );
}

/** Compact summary bar: ✅ 3 done  🔵 2 running  🟢 1 ready  ⏳ 2 pending */
function SummaryBar({ summary }: { summary: DagStatus['summary'] }) {
  const entries = ([
    { key: 'done' as const, count: summary.done },
    { key: 'running' as const, count: summary.running },
    { key: 'ready' as const, count: summary.ready },
    { key: 'pending' as const, count: summary.pending },
    { key: 'failed' as const, count: summary.failed },
    { key: 'blocked' as const, count: summary.blocked },
    { key: 'paused' as const, count: summary.paused },
    { key: 'skipped' as const, count: summary.skipped },
  ] satisfies Array<{ key: DagTask['dagStatus']; count: number }>).filter((e) => e.count > 0);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 py-1 text-[11px]">
      {entries.map((e) => {
        const cfg = STATUS_CONFIG[e.key];
        return (
          <span key={e.key} className={`${dagTaskText(e.key)} whitespace-nowrap`}>
            {cfg.icon} {e.count} {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

/** Single task card */
function TaskCard({ task }: { task: DagTask }) {
  const cfg = STATUS_CONFIG[task.dagStatus];

  return (
    <div className={`px-2 py-1.5 border-b border-th-border/50 hover:bg-th-bg-alt/30 ${cfg.strikethrough ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <StatusBadge status={task.dagStatus} />
        <span className={`text-xs text-th-text-alt truncate ${cfg.strikethrough ? 'line-through' : ''}`}>
          {task.title || task.id}
        </span>
        {task.title && (
          <span className="text-[9px] font-mono text-th-text-muted bg-th-bg-alt/50 px-1 rounded shrink-0">{task.id}</span>
        )}
        <span className="text-[10px] text-th-text-muted ml-auto shrink-0">({task.role})</span>
      </div>
      {task.description && (
        <p className="text-[11px] text-th-text-muted mt-0.5 leading-tight line-clamp-2 pl-1">
          {task.description}
        </p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0 mt-0.5 pl-1 text-[10px] text-th-text-muted">
        {task.dependsOn.length > 0 && (
          <span>deps: [{task.dependsOn.join(', ')}]</span>
        )}
        {task.files.length > 0 && (
          <span>files: [{task.files.join(', ')}]</span>
        )}
        {task.assignedAgentId && (
          <span>agent: {shortAgentId(task.assignedAgentId)}</span>
        )}
      </div>
    </div>
  );
}

/** File lock map shown when there are running tasks with file locks */
function FileLockMap({ fileLockMap }: { fileLockMap: DagStatus['fileLockMap'] }) {
  const entries = Object.entries(fileLockMap);
  if (entries.length === 0) return null;

  return (
    <div className="border-t border-th-border px-2 py-1.5">
      <div className="text-[10px] font-semibold text-th-text-muted mb-0.5">File Locks</div>
      {entries.map(([file, lock]) => (
        <div key={file} className="text-[10px] text-th-text-muted flex items-center gap-1 leading-relaxed">
          <span className="text-blue-400">🔒</span>
          <span className="font-mono truncate">{file}</span>
          <span className="text-th-text-muted ml-auto shrink-0">
            ← {lock.taskId}{lock.agentId ? ` (${shortAgentId(lock.agentId)})` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Main Task DAG panel content — rendered inside a CollapsibleSection */
export function TaskDagPanelContent({ dagStatus }: { dagStatus: DagStatus | null }) {
  if (!dagStatus) {
    return (
      <div className="px-3 py-4 text-xs text-th-text-muted text-center">
        No DAG data available
      </div>
    );
  }

  const { tasks, fileLockMap, summary } = dagStatus;
  const hasFileLocks = Object.keys(fileLockMap).length > 0 && summary.running > 0;

  // Sort tasks: running first, then ready, then pending, then the rest
  const statusOrder: Record<DagTask['dagStatus'], number> = {
    running: 0, in_review: 1, ready: 2, pending: 3, blocked: 4, paused: 5, failed: 6, done: 7, skipped: 8,
  };
  const sorted = [...tasks].sort((a, b) => statusOrder[a.dagStatus] - statusOrder[b.dagStatus] || a.priority - b.priority);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SummaryBar summary={summary} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
      {hasFileLocks && <FileLockMap fileLockMap={fileLockMap} />}
    </div>
  );
}
