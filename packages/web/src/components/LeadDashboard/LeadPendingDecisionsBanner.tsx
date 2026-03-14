import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { BannerDecisionActions } from './DecisionPanel';
import type { Decision } from '../../types';

interface Props {
  pendingConfirmations: Decision[];
  onConfirm: (id: string, reason?: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}

export function LeadPendingDecisionsBanner({ pendingConfirmations, onConfirm, onReject, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (pendingConfirmations.length === 0) return null;

  return (
    <div className="border-b border-amber-700/50 bg-amber-900/30">
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-200 hover:bg-amber-900/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="font-mono font-medium">⚠ {pendingConfirmations.length} decision{pendingConfirmations.length !== 1 ? 's' : ''} need{pendingConfirmations.length === 1 ? 's' : ''} your confirmation</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-amber-400" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto text-amber-400" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {pendingConfirmations.map((d) => (
            <div key={d.id} className="bg-th-bg-alt/80 border border-amber-700/40 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-semibold text-th-text-alt">{d.title}</span>
                    {d.agentRole && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">{d.agentRole}</span>
                    )}
                  </div>
                  {d.rationale && (
                    <p className="text-xs font-mono text-th-text-muted line-clamp-2">{d.rationale}</p>
                  )}
                </div>
              </div>
              <BannerDecisionActions
                decisionId={d.id}
                onConfirm={onConfirm}
                onReject={onReject}
                onDismiss={onDismiss}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
