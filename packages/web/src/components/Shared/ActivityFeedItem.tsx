import { ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

export interface ActivityEntry {
  id: number;
  agentId: string;
  agentRole: string;
  actionType: string;
  summary: string;
  timestamp: string;
  projectId: string;
}

const ACTIVITY_ICONS: Record<string, string> = {
  progress: '📊',
  task_completed: '✅',
  task_started: '▶️',
  decision_made: '⚖️',
  delegated: '📋',
  deferred_issue: '📌',
};

export { ACTIVITY_ICONS };

export function ActivityFeedItem({ entry, projectName, onClick }: { entry: ActivityEntry; projectName: string; onClick?: () => void }) {
  const icon = ACTIVITY_ICONS[entry.actionType] ?? '📎';
  return (
    <button
      type="button"
      className="flex items-start gap-2.5 px-3 py-2 w-full text-left hover:bg-th-bg-hover/30 transition-colors cursor-pointer"
      data-testid="activity-feed-item"
      onClick={onClick}
    >
      <span className="text-sm shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-th-text-alt truncate block">{entry.summary}</span>
        <div className="text-[10px] text-th-text-muted mt-0.5">
          {entry.agentRole} · {projectName} · {formatRelativeTime(entry.timestamp)}
        </div>
      </div>
      <ChevronRight className="w-3 h-3 text-th-text-muted/50 shrink-0 mt-1" />
    </button>
  );
}
