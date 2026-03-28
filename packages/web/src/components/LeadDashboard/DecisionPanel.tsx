import { useState, useEffect, useRef } from 'react';
import { Check, X, Lightbulb, EyeOff } from 'lucide-react';
import type { Decision } from '../../types';
import { formatTime, formatFullTimestamp } from '../../utils/format';

/** Decision with optional detail fields that may arrive from the API */
type DecisionDetail = Decision & { alternatives?: string[]; impact?: string };

/** Inline comment + action buttons for pending decisions in the banner */
export function BannerDecisionActions({ decisionId, onConfirm, onReject, onDismiss }: {
  decisionId: string;
  onConfirm: (id: string, reason?: string) => void;
  onReject: (id: string, reason?: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') onConfirm(decisionId, reason.trim() || undefined); }}
        placeholder="Comment (optional)..."
        className="flex-1 bg-th-bg border border-th-border rounded px-2 py-1 text-xs text-th-text-alt focus:outline-none focus:border-yellow-500"
      />
      <button
        type="button"
        aria-label="Confirm decision"
        onClick={() => onConfirm(decisionId, reason.trim() || undefined)}
        className="p-1.5 rounded bg-green-800 hover:bg-green-700 text-green-600 dark:text-green-200 transition-colors"
        title="Confirm"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label="Reject decision"
        onClick={() => onReject(decisionId, reason.trim() || undefined)}
        className="p-1.5 rounded bg-red-800 hover:bg-red-700 text-red-600 dark:text-red-200 transition-colors"
        title="Reject"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss decision"
          onClick={() => onDismiss(decisionId)}
          className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 dark:text-gray-300 transition-colors"
          title="Dismiss (ignore)"
        >
          <EyeOff className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function DecisionPanelContent({ decisions, onConfirm, onReject, onDismiss }: { decisions: Decision[]; onConfirm?: (id: string, reason?: string) => void; onReject?: (id: string, reason?: string) => void; onDismiss?: (id: string) => void }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [selectedDecision, setSelectedDecision] = useState<DecisionDetail | null>(null);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  useEffect(() => {
    requestAnimationFrame(() => {
      feedRef.current?.scrollTo({ top: 0 });
    });
  }, [decisions.length]);

  return (
    <>
      <div ref={feedRef} className="h-full overflow-y-auto p-2 space-y-2">
        {decisions.length === 0 ? (
          <p className="text-xs text-th-text-muted text-center py-4 font-mono">No decisions yet</p>
        ) : (
          decisions.map((d: Decision, i: number) => (
            <div
              key={d.id || `dec-${i}`}
              className={`cv-auto-lg bg-th-bg-alt border rounded p-2 cursor-pointer hover:bg-th-bg-muted/50 transition-colors ${d.needsConfirmation && d.status === 'recorded' ? 'border-yellow-600' : d.status === 'rejected' ? 'border-red-700' : 'border-th-border'}`}
              onClick={() => setSelectedDecision(d)}
            >
              <div className="flex items-start gap-2">
                <Lightbulb className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-semibold text-th-text-alt truncate">{d.title}</p>
                    {d.agentRole && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">{d.agentRole}</span>
                    )}
                    {d.status && d.status !== 'recorded' && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${d.status === 'confirmed' ? 'bg-green-500/20 text-green-600 dark:text-green-300' : d.status === 'dismissed' ? 'bg-gray-500/20 text-gray-400' : 'bg-red-500/20 text-red-600 dark:text-red-300'}`}>{d.status}</span>
                    )}
                  </div>
                  {d.rationale && <p className="text-xs font-mono text-th-text-muted mt-1 line-clamp-2">{d.rationale}</p>}
                  <p className="text-xs text-th-text-muted mt-1">{formatTime(d.timestamp)}</p>
                  {d.needsConfirmation && d.status === 'recorded' && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={decisionReasons[d.id] ?? ''}
                        onChange={(e) => setDecisionReasons((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { onConfirm?.(d.id, decisionReasons[d.id]?.trim() || undefined); } }}
                        placeholder="Add a comment (optional)..."
                        className="w-full bg-th-bg border border-th-border rounded px-2 py-1 text-xs text-th-text-alt focus:outline-none focus:border-yellow-500 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { onConfirm?.(d.id, decisionReasons[d.id]?.trim() || undefined); }}
                          className="text-xs px-2 py-1 rounded bg-green-800 hover:bg-green-700 text-green-600 dark:text-green-200 flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Confirm
                        </button>
                        <button
                          onClick={() => { onReject?.(d.id, decisionReasons[d.id]?.trim() || undefined); }}
                          className="text-xs px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-red-600 dark:text-red-200 flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Reject
                        </button>
                        {onDismiss && (
                          <button
                            onClick={() => { onDismiss(d.id); }}
                            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 dark:text-gray-300 flex items-center gap-1"
                          >
                            <EyeOff className="w-3 h-3" /> Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Decision detail popup */}
      {selectedDecision && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedDecision(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span className="text-sm font-semibold text-th-text">Decision</span>
                {selectedDecision.agentRole && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">by {selectedDecision.agentRole}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {formatFullTimestamp(selectedDecision.timestamp)}
                </span>
                <button type="button" aria-label="Close decision detail" onClick={() => setSelectedDecision(null)} className="text-th-text-muted hover:text-th-text">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto">
              <h3 className="text-base font-mono font-semibold text-th-text mb-3">{selectedDecision.title}</h3>
              {selectedDecision.rationale && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-th-text-muted mb-1">Rationale</p>
                  <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{selectedDecision.rationale}</p>
                </div>
              )}
              {selectedDecision.alternatives && selectedDecision.alternatives.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-th-text-muted mb-1">Alternatives considered</p>
                  <ul className="list-disc list-inside text-sm font-mono text-th-text-muted space-y-1">
                    {selectedDecision.alternatives.map((alt: string, i: number) => (
                      <li key={i}>{alt}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedDecision.impact && (
                <div>
                  <p className="text-xs font-semibold text-th-text-muted mb-1">Impact</p>
                  <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{selectedDecision.impact}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
