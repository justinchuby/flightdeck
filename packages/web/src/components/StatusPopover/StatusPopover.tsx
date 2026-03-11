import { useState, useEffect, useRef, useMemo } from 'react';
import { CheckCircle, XCircle, Activity, Users, Clock } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

// ── Types ─────────────────────────────────────────────────

interface StatusRowProps {
  icon: typeof CheckCircle;
  iconColor: string;
  label: string;
  value: string;
  detail?: string;
}

// ── Helpers ───────────────────────────────────────────────

function StatusRow({ icon: Icon, iconColor, label, value, detail }: StatusRowProps) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-th-text-muted">{label}</span>
          <span className="text-xs font-medium text-th-text-alt">{value}</span>
        </div>
        {detail && (
          <span className="text-[10px] text-th-text-muted/70">{detail}</span>
        )}
      </div>
    </div>
  );
}

function statusIcon(ok: boolean): { icon: typeof CheckCircle; color: string } {
  return ok
    ? { icon: CheckCircle, color: 'text-green-400' }
    : { icon: XCircle, color: 'text-red-400' };
}

// ── Component ─────────────────────────────────────────────

export function StatusPopover() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const connected = useAppStore((s) => s.connected);
  const systemPaused = useAppStore((s) => s.systemPaused);
  const agents = useAppStore((s) => s.agents);


  // Click-outside close
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Escape key close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Agent counts
  const agentCounts = useMemo(() => {
    const running = agents.filter((a) => a.status === 'running' || a.status === 'creating').length;
    const idle = agents.filter((a) => a.status === 'idle').length;
    const terminated = agents.filter((a) => a.status === 'terminated' || a.status === 'completed').length;
    return { running, idle, terminated, total: agents.length };
  }, [agents]);

  // Last activity: most recent agent createdAt
  const lastActivity = useMemo(() => {
    if (agents.length === 0) return null;
    const sorted = [...agents].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });
    return sorted[0].createdAt;
  }, [agents]);

  // Overall health
  const overallDegraded = connected && systemPaused;
  const overallOk = connected && !overallDegraded;

  const dotColor = !connected
    ? 'bg-red-400'
    : overallDegraded
      ? 'bg-yellow-400'
      : 'bg-green-400';

  const statusLabel = !connected
    ? 'Server: Reconnecting...'
    : systemPaused
      ? 'Server: Paused'
      : 'Server: Connected';

  // Connection row — destructure once to avoid calling statusIcon twice
  const connIcon = statusIcon(connected);

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger — clickable status indicator */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-th-bg-muted transition-colors"
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="status-popover-trigger"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-sm text-th-text-muted">{statusLabel}</span>
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-72 bg-surface-raised border border-th-border rounded-lg shadow-lg z-50"
          role="dialog"
          aria-label="System status details"
          data-testid="status-popover"
        >
          {/* Header */}
          <div className="px-4 pt-3 pb-2 border-b border-th-border">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-th-text-muted" />
              <span className="text-sm font-medium text-th-text-alt">System Status</span>
              {overallOk && (
                <span className="ml-auto text-[10px] font-medium text-green-400 uppercase">Healthy</span>
              )}
              {overallDegraded && (
                <span className="ml-auto text-[10px] font-medium text-yellow-400 uppercase">Degraded</span>
              )}
              {!connected && (
                <span className="ml-auto text-[10px] font-medium text-red-400 uppercase">Disconnected</span>
              )}
            </div>
          </div>

          {/* Status rows */}
          <div className="px-4 py-2 space-y-0.5">
            <StatusRow
              icon={connIcon.icon}
              iconColor={connIcon.color}
              label="Server Connection"
              value={connected ? (systemPaused ? 'Paused' : 'Connected') : 'Disconnected'}
              detail={connected ? 'WebSocket active' : 'Attempting to reconnect...'}
            />

            <StatusRow
              icon={Users}
              iconColor="text-th-text-muted"
              label="Active Agents"
              value={`${agentCounts.total} total`}
              detail={`${agentCounts.running} running, ${agentCounts.idle} idle, ${agentCounts.terminated} done`}
            />

            {lastActivity && (
              <StatusRow
                icon={Clock}
                iconColor="text-th-text-muted"
                label="Last Activity"
                value={formatRelativeTime(lastActivity)}
              />
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-th-border">
            <span className="text-[10px] text-th-text-muted/60">Click outside or press Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
