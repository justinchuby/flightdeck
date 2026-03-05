import { useEffect, useCallback } from 'react';
import { X, ListChecks } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { sendWsMessage } from '../../hooks/useWebSocket';
import { ApprovalQueue } from './ApprovalQueue';

export function ApprovalSlideOver() {
  const isOpen = useAppStore((s) => s.approvalQueueOpen);
  const pendingCount = useAppStore((s) => s.pendingDecisions.length);
  const setOpen = useAppStore((s) => s.setApprovalQueueOpen);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, close]);

  // Timer pause: send queue_open/queue_closed via WebSocket so decisions don't auto-deny while reviewing
  useEffect(() => {
    sendWsMessage({ type: isOpen ? 'queue_open' : 'queue_closed' });
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        onClick={close}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-surface border-l border-th-border shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-th-border shrink-0">
          <ListChecks className="w-5 h-5 text-accent" />
          <h2 className="text-sm font-semibold text-th-text-alt flex-1">
            Approval Queue
          </h2>
          <span className="text-xs text-th-text-muted font-mono">
            {pendingCount} pending
          </span>
          <button
            onClick={close}
            className="p-1 rounded-md text-th-text-muted hover:text-th-text hover:bg-th-bg-alt transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Queue content */}
        <ApprovalQueue />
      </div>
    </>
  );
}
