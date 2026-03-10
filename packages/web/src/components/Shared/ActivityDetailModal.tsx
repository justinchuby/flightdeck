import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ActivityEntry } from './ActivityFeedItem';
import { ACTIVITY_ICONS } from './ActivityFeedItem';

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  progress: 'Progress Update',
  task_completed: 'Task Completed',
  task_started: 'Task Started',
  decision_made: 'Decision Made',
  delegated: 'Delegated',
  deferred_issue: 'Deferred Issue',
};

export function ActivityDetailModal({
  entry,
  projectName,
  onClose,
}: {
  entry: ActivityEntry;
  projectName: string;
  onClose: () => void;
}) {
  const icon = ACTIVITY_ICONS[entry.actionType] ?? '📎';

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="activity-detail-modal"
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-th-border">
          <span className="text-base">{icon}</span>
          <h2 className="text-sm font-semibold text-th-text flex-1">Activity Detail</h2>
          <button type="button" onClick={onClose} className="text-th-text-muted hover:text-th-text">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div>
            <div className="text-xs text-th-text-muted mb-0.5">Type</div>
            <div className="text-sm text-th-text flex items-center gap-1.5">
              <span>{icon}</span>
              {ACTIVITY_TYPE_LABELS[entry.actionType] ?? entry.actionType}
            </div>
          </div>
          <div>
            <div className="text-xs text-th-text-muted mb-0.5">Summary</div>
            <div className="text-sm text-th-text whitespace-pre-wrap">{entry.summary}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Reported by</div>
              <span className="text-sm text-th-text">{entry.agentRole}</span>
            </div>
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Project</div>
              <span className="text-sm text-th-text">{projectName}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-th-text-muted mb-0.5">Timestamp</div>
            <span className="text-xs text-th-text">
              {new Date(entry.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
