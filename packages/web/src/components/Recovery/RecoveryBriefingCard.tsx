import { useState, useCallback } from 'react';
import { Edit3, Check, X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { TRIGGER_LABELS, type RecoveryEvent } from './types';

interface RecoveryBriefingCardProps {
  event: RecoveryEvent;
  onApproved?: () => void;
  onCancelled?: () => void;
}

export function RecoveryBriefingCard({ event, onApproved, onCancelled }: RecoveryBriefingCardProps) {
  const [editing, setEditing] = useState(false);
  const [narrative, setNarrative] = useState(event.briefing?.narrative ?? '');
  const [loading, setLoading] = useState(false);

  const briefing = event.briefing;
  const agentLabel = event.originalAgentId.slice(0, 8);
  const trigger = TRIGGER_LABELS[event.trigger];

  const handleApprove = useCallback(async () => {
    setLoading(true);
    try {
      await apiFetch(`/recovery/${event.id}/approve`, { method: 'POST' });
      onApproved?.();
    } catch { /* toast handled upstream */ }
    finally { setLoading(false); }
  }, [event.id, onApproved]);

  const handleCancel = useCallback(async () => {
    setLoading(true);
    try {
      await apiFetch(`/recovery/${event.id}/cancel`, { method: 'POST' });
      onCancelled?.();
    } catch { /* toast handled upstream */ }
    finally { setLoading(false); }
  }, [event.id, onCancelled]);

  const handleSaveAndRestart = useCallback(async () => {
    setLoading(true);
    try {
      await apiFetch(`/recovery/${event.id}/briefing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narrative }),
      });
      await apiFetch(`/recovery/${event.id}/approve`, { method: 'POST' });
      onApproved?.();
    } catch { /* toast handled upstream */ }
    finally { setLoading(false); }
  }, [event.id, narrative, onApproved]);

  // Token estimate (~4 chars per token)
  const estimatedTokens = Math.round(narrative.length / 4);

  return (
    <div
      className="border border-th-border border-l-4 border-l-blue-400 rounded-lg p-4 bg-surface-raised"
      data-testid="recovery-briefing-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">🔄</span>
        <span className="text-xs font-semibold text-th-text-alt uppercase tracking-wide">Recovery Handoff</span>
      </div>
      <p className="text-xs text-th-text-muted mb-3">
        Agent {agentLabel} — {trigger} during{' '}
        {briefing?.currentTask ? `"${briefing.currentTask.title}"` : 'active work'}
      </p>

      {/* Briefing preview / editor */}
      {!editing ? (
        <div className="bg-th-bg-alt border border-th-border rounded-md p-3 mb-3">
          {briefing ? (
            <>
              <p className="text-[11px] text-th-text-alt mb-2">{briefing.narrative}</p>
              {briefing.currentTask && (
                <p className="text-[10px] text-th-text-muted">
                  📋 Last task: {briefing.currentTask.title} — {briefing.currentTask.progress}
                </p>
              )}
              {briefing.uncommittedChanges.length > 0 && (
                <p className="text-[10px] text-th-text-muted font-mono mt-1">
                  📝 Uncommitted: {briefing.uncommittedChanges.map((f) =>
                    `${f.file} (+${f.additions} -${f.deletions})`).join(', ')}
                </p>
              )}
              {briefing.discoveries.length > 0 && (
                <p className="text-[10px] text-th-text-muted mt-1">
                  💡 {briefing.discoveries[0]}
                </p>
              )}
              <p className="text-[9px] text-th-text-muted mt-1">
                Context at crash: {briefing.contextUsageAtCrash}%
              </p>
            </>
          ) : (
            <p className="text-xs text-th-text-muted">No briefing generated yet</p>
          )}
        </div>
      ) : (
        <div className="mb-3">
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            className="w-full h-24 bg-th-bg-alt border border-th-border rounded-md p-2 text-xs text-th-text-alt resize-y focus:ring-1 focus:ring-accent outline-none"
          />
          <p className="text-[9px] text-th-text-muted text-right mt-0.5">{narrative.length} chars</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!editing ? (
          <>
            <button
              onClick={() => setEditing(true)}
              disabled={loading || !briefing}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-th-border text-th-text-muted hover:text-th-text disabled:opacity-40 transition-colors"
            >
              <Edit3 size={12} /> Edit Briefing
            </button>
            <button
              onClick={handleApprove}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              <Check size={12} /> Approve & Restart
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
            >
              <X size={12} /> Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(false)}
              className="text-[11px] px-2.5 py-1.5 rounded-md border border-th-border text-th-text-muted hover:text-th-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAndRestart}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              <Check size={12} /> Save & Restart →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
