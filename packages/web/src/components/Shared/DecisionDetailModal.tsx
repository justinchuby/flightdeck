import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Decision } from '../../types';
import { DECISION_CATEGORY_ICONS } from './DecisionFeedItem';

const DECISION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  confirmed: { label: 'Confirmed', color: 'text-green-400' },
  rejected: { label: 'Rejected', color: 'text-red-400' },
  recorded: { label: 'Recorded', color: 'text-th-text-muted' },
  dismissed: { label: 'Dismissed', color: 'text-yellow-400' },
};

const DECISION_CATEGORY_LABELS: Record<string, string> = {
  style: 'Code Style',
  architecture: 'Architecture',
  tool_access: 'Tool Access',
  dependency: 'Dependency',
  testing: 'Testing',
  general: 'General',
};

export function DecisionDetailModal({
  decision,
  projectName,
  onClose,
}: {
  decision: Decision;
  projectName: string;
  onClose: () => void;
}) {
  const icon = DECISION_CATEGORY_ICONS[decision.category] ?? '💡';
  const statusInfo = DECISION_STATUS_LABELS[decision.status] ?? DECISION_STATUS_LABELS.recorded;

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="decision-detail-modal"
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-th-border">
          <span className="text-base">{icon}</span>
          <h2 className="text-sm font-semibold text-th-text flex-1">Decision Detail</h2>
          <button type="button" onClick={onClose} className="text-th-text-muted hover:text-th-text">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
          <div>
            <div className="text-xs text-th-text-muted mb-0.5">Title</div>
            <div className="text-sm text-th-text">{decision.title}</div>
          </div>
          {decision.rationale && (
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Rationale</div>
              <div className="text-sm text-th-text whitespace-pre-wrap">{decision.rationale}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Status</div>
              <span className={`text-sm font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
            </div>
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Category</div>
              <span className="text-sm text-th-text">{DECISION_CATEGORY_LABELS[decision.category] ?? decision.category}</span>
            </div>
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Made by</div>
              <span className="text-sm text-th-text">{decision.agentRole}</span>
            </div>
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Project</div>
              <span className="text-sm text-th-text">{projectName}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-th-text-muted mb-0.5">Timestamp</div>
              <span className="text-xs text-th-text">
                {new Date(decision.timestamp).toLocaleString()}
              </span>
            </div>
            {decision.confirmedAt && (
              <div>
                <div className="text-xs text-th-text-muted mb-0.5">Confirmed At</div>
                <span className="text-xs text-th-text">
                  {new Date(decision.confirmedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-3 text-xs text-th-text-muted pt-1 border-t border-th-border/50">
            {decision.autoApproved && <span>✓ Auto-approved</span>}
            {decision.needsConfirmation && <span>⚠ Requires confirmation</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
