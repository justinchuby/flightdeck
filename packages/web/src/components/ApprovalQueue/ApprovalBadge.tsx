import { Bell } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function ApprovalBadge() {
  const pendingCount = useAppStore((s) => s.pendingDecisions.length);
  const setOpen = useAppStore((s) => s.setApprovalQueueOpen);

  return (
    <button
      onClick={() => setOpen(true)}
      className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors text-xs"
      title={pendingCount > 0 ? `${pendingCount} decisions awaiting approval` : 'No pending decisions'}
    >
      <Bell className="w-3.5 h-3.5" />
      <span>Approvals</span>
      {pendingCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 animate-pulse">
          {pendingCount > 99 ? '99+' : pendingCount}
        </span>
      )}
    </button>
  );
}
