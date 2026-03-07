import { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { apiFetch } from '../../hooks/useApi';

/**
 * Swipe-to-approve card stack for mobile.
 * Right swipe = approve, left swipe = reject, up swipe = dismiss.
 * Shows peeking cards behind the active card for depth.
 */
export function MobileApprovalStack() {
  const pendingDecisions = useAppStore(s => s.pendingDecisions);
  const removePendingDecision = useAppStore(s => s.removePendingDecision);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const current = pendingDecisions[currentIndex];

  const advance = useCallback(() => {
    setCurrentIndex(i => i + 1);
    setExpanded(false);
  }, []);

  const handleApprove = useCallback(async () => {
    if (!current) return;
    try {
      await apiFetch(`/decisions/${current.id}/approve`, { method: 'POST' });
      removePendingDecision(current.id);
    } catch { /* toast handled elsewhere */ }
    advance();
  }, [current, removePendingDecision, advance]);

  const handleReject = useCallback(async () => {
    if (!current) return;
    try {
      await apiFetch(`/decisions/${current.id}/reject`, { method: 'POST' });
      removePendingDecision(current.id);
    } catch { /* toast handled elsewhere */ }
    advance();
  }, [current, removePendingDecision, advance]);

  const handleDismiss = useCallback(async () => {
    if (!current) return;
    try {
      await apiFetch(`/decisions/${current.id}/dismiss`, { method: 'POST' });
      removePendingDecision(current.id);
    } catch { /* toast handled elsewhere */ }
    advance();
  }, [current, removePendingDecision, advance]);

  const swipe = useSwipeGesture({
    onSwipeRight: handleApprove,
    onSwipeLeft: handleReject,
    onSwipeUp: handleDismiss,
  });

  if (pendingDecisions.length === 0 || currentIndex >= pendingDecisions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">✅</div>
        <div className="text-sm font-semibold text-th-text">All caught up!</div>
        <div className="text-xs text-th-text-muted">No pending decisions</div>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-sm mx-auto" style={{ minHeight: 300 }}>
      {/* Directional hints */}
      <div className="flex justify-between text-xs text-th-text-muted mb-2 px-4">
        <span>← REJECT</span>
        <span className="text-gray-500">↑ DISMISS</span>
        <span>APPROVE →</span>
      </div>

      {/* Card stack */}
      <div className="relative" style={{ height: 280 }}>
        {/* Third card peek */}
        {pendingDecisions[currentIndex + 2] && (
          <div
            className="absolute inset-x-4 top-2 h-full bg-th-bg-alt border border-th-border-muted rounded-xl opacity-50"
            style={{ transform: 'scale(0.9) translateY(8px)' }}
          />
        )}
        {/* Second card peek */}
        {pendingDecisions[currentIndex + 1] && (
          <div
            className="absolute inset-x-2 top-1 h-full bg-th-bg-alt border border-th-border-muted rounded-xl opacity-70"
            style={{ transform: 'scale(0.95) translateY(4px)' }}
          />
        )}

        {/* Active card */}
        <div
          onTouchStart={swipe.onTouchStart}
          onTouchMove={swipe.onTouchMove}
          onTouchEnd={swipe.onTouchEnd}
          className="relative bg-th-bg border border-th-border rounded-xl p-5 shadow-lg transition-colors motion-scale-in"
          style={{
            transform: `translate(${swipe.offsetX}px, ${Math.min(0, swipe.offsetY)}px) rotate(${swipe.offsetX * 0.05}deg)`,
            transition: swipe.swiping ? 'none' : 'transform 0.3s ease',
          }}
        >
          {/* Swipe overlays */}
          {swipe.offsetX > 30 && (
            <div className="absolute inset-0 bg-green-500/10 rounded-xl flex items-center justify-center pointer-events-none">
              <span className="text-4xl">✓</span>
            </div>
          )}
          {swipe.offsetX < -30 && (
            <div className="absolute inset-0 bg-red-500/10 rounded-xl flex items-center justify-center pointer-events-none">
              <span className="text-4xl">✗</span>
            </div>
          )}

          <div className="text-sm font-medium text-th-text mb-1">
            🎯 {current.category || 'Decision'}
          </div>
          <div className="text-xs text-th-text-muted mb-3">
            {current.title || 'Pending approval'}
          </div>

          {current.agentRole && (
            <div className="text-xs text-th-text-muted mb-2">
              🏗 {current.agentRole}
              {current.status && <> • Status: {current.status}</>}
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-accent hover:underline"
          >
            {expanded ? 'Hide Details ▴' : 'View Details ▾'}
          </button>

          {expanded && (
            <div className="mt-3 pt-3 border-t border-th-border text-xs text-th-text-muted whitespace-pre-wrap">
              {current.rationale || 'No additional details available.'}
            </div>
          )}
        </div>
      </div>

      {/* Card counter */}
      <div className="text-center mt-3 text-xs text-th-text-muted">
        Card {currentIndex + 1} of {pendingDecisions.length}
      </div>

      {/* Tap fallback buttons */}
      <div className="flex justify-center gap-4 mt-3">
        <button
          onClick={handleReject}
          className="px-4 py-2 text-xs rounded-lg border border-red-400/30 text-red-400 hover:bg-red-400/10"
        >
          ✗ Reject
        </button>
        <button
          onClick={handleDismiss}
          className="px-4 py-2 text-xs rounded-lg border border-gray-400/30 text-gray-400 hover:bg-gray-400/10"
        >
          Dismiss ↑
        </button>
        <button
          onClick={handleApprove}
          className="px-4 py-2 text-xs rounded-lg border border-green-400/30 text-green-400 hover:bg-green-400/10"
        >
          ✓ Approve
        </button>
      </div>
    </div>
  );
}
