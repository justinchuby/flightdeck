import { CheckCircle2, XCircle, Clock, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import type { Decision } from '../../types';

const DECISION_CATEGORY_ICONS: Record<string, string> = {
  architecture: '🏗️',
  dependency: '📦',
  style: '🎨',
  tool_access: '🔧',
  testing: '🧪',
  general: '💡',
};

export { DECISION_CATEGORY_ICONS };

export function DecisionFeedItem({ decision, projectName, onClick }: { decision: Decision; projectName: string; onClick?: () => void }) {
  const icon = DECISION_CATEGORY_ICONS[decision.category] ?? '💡';
  const statusIcon = decision.status === 'confirmed'
    ? <CheckCircle2 className="w-3 h-3 text-green-400" />
    : decision.status === 'rejected'
      ? <XCircle className="w-3 h-3 text-red-400" />
      : <Clock className="w-3 h-3 text-th-text-muted" />;

  return (
    <button
      type="button"
      className="flex items-start gap-2.5 px-3 py-2 w-full text-left hover:bg-th-bg-hover/30 transition-colors cursor-pointer"
      data-testid="decision-feed-item"
      onClick={onClick}
    >
      <span className="text-sm shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {statusIcon}
          <span className="text-xs text-th-text-alt truncate">{decision.title}</span>
        </div>
        <div className="text-[10px] text-th-text-muted mt-0.5">
          {decision.agentRole} · {projectName} · {formatRelativeTime(decision.timestamp)}
        </div>
      </div>
      <ChevronRight className="w-3 h-3 text-th-text-muted/50 shrink-0 mt-1" />
    </button>
  );
}
