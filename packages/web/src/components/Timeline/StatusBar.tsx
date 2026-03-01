import { useMemo } from 'react';
import {
  Wifi,
  WifiOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import type { TimelineData, TimelineStatus } from './useTimelineData';

// ── Types ─────────────────────────────────────────────────────────────

export type ConnectionHealth =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'degraded'
  | 'offline';

export type OverallHealth = 'green' | 'yellow' | 'red';

export interface StatusBarProps {
  /** Unfiltered timeline data — StatusBar always shows full crew state */
  data: TimelineData | null;
  /** Connection health state */
  connectionHealth?: ConnectionHealth;
  /** Count of new events since last visit */
  newEventCount?: number;
  /** Callback when user clicks the error count link */
  onErrorClick?: () => void;
}

interface StatusBuckets {
  creating: number;
  running: number;
  idle: number;
  completed: number;
  failed: number;
  terminated: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function computeStatusBuckets(data: TimelineData): StatusBuckets {
  const buckets: StatusBuckets = {
    creating: 0,
    running: 0,
    idle: 0,
    completed: 0,
    failed: 0,
    terminated: 0,
  };

  for (const agent of data.agents) {
    const lastSegment = agent.segments[agent.segments.length - 1];
    const status: TimelineStatus = lastSegment?.status ?? 'idle';
    if (status in buckets) {
      buckets[status]++;
    }
  }

  return buckets;
}

function computeErrorCount(data: TimelineData): number {
  return data.agents.filter((agent) => {
    const lastSegment = agent.segments[agent.segments.length - 1];
    return lastSegment?.status === 'failed';
  }).length;
}

function computeOverallHealth(
  buckets: StatusBuckets,
  connectionHealth: ConnectionHealth,
): OverallHealth {
  if (connectionHealth === 'offline') return 'red';
  if (buckets.failed > 0) return 'red';
  if (connectionHealth === 'degraded' || connectionHealth === 'reconnecting') {
    return 'yellow';
  }
  if (buckets.terminated > 0) return 'yellow';
  return 'green';
}

function computeActiveCount(buckets: StatusBuckets): number {
  return buckets.creating + buckets.running + buckets.idle;
}

function buildNarrativeSentence(
  activeCount: number,
  errorCount: number,
): string {
  const agentWord = activeCount === 1 ? 'agent' : 'agents';
  if (errorCount === 0) {
    return `Your crew has ${activeCount} active ${agentWord}. All systems normal.`;
  }
  const errorWord = errorCount === 1 ? 'error needs' : 'errors need';
  return `Your crew has ${activeCount} active ${agentWord}. ${errorCount} ${errorWord} attention.`;
}

// ── Sub-components ────────────────────────────────────────────────────

const HEALTH_STYLES: Record<OverallHealth, { bg: string; border: string; dot: string; label: string }> = {
  green: {
    bg: 'bg-emerald-900/20',
    border: 'border-emerald-800/50',
    dot: 'bg-emerald-400',
    label: 'Healthy',
  },
  yellow: {
    bg: 'bg-yellow-900/20',
    border: 'border-yellow-800/50',
    dot: 'bg-yellow-400',
    label: 'Attention needed',
  },
  red: {
    bg: 'bg-red-900/20',
    border: 'border-red-800/50',
    dot: 'bg-red-400',
    label: 'Errors detected',
  },
};

const CONNECTION_CONFIG: Record<ConnectionHealth, { icon: typeof Wifi; label: string; className: string }> = {
  connected: { icon: Wifi, label: 'Connected', className: 'text-emerald-400' },
  connecting: { icon: Loader2, label: 'Connecting…', className: 'text-yellow-400 animate-spin motion-reduce:animate-none' },
  reconnecting: { icon: Loader2, label: 'Reconnecting…', className: 'text-yellow-400 animate-spin motion-reduce:animate-none' },
  degraded: { icon: AlertTriangle, label: 'Degraded', className: 'text-yellow-400' },
  offline: { icon: WifiOff, label: 'Offline', className: 'text-red-400' },
};

function HealthIndicator({ health }: { health: OverallHealth }) {
  const style = HEALTH_STYLES[health];
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${style.bg} ${style.border} border`}
      aria-label={`Crew health: ${style.label}`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      <span className="text-xs font-medium text-th-text-alt">{style.label}</span>
    </div>
  );
}

function ConnectionIndicator({ health }: { health: ConnectionHealth }) {
  const config = CONNECTION_CONFIG[health];
  const Icon = config.icon;
  const isOffline = health === 'offline';

  return (
    <div
      className="flex items-center gap-1"
      aria-live={isOffline ? 'assertive' : 'polite'}
      aria-label={`Connection: ${config.label}`}
    >
      <Icon size={14} className={config.className} />
      <span className={`text-xs ${config.className}`}>{config.label}</span>
    </div>
  );
}

const STATUS_DISPLAY: { key: keyof StatusBuckets; label: string; icon: typeof Circle; className: string }[] = [
  { key: 'running', label: 'Running', icon: Circle, className: 'text-emerald-400' },
  { key: 'creating', label: 'Creating', icon: Circle, className: 'text-yellow-400' },
  { key: 'idle', label: 'Idle', icon: Circle, className: 'text-zinc-400' },
  { key: 'completed', label: 'Done', icon: CheckCircle2, className: 'text-blue-400' },
  { key: 'failed', label: 'Failed', icon: AlertTriangle, className: 'text-red-400' },
  { key: 'terminated', label: 'Terminated', icon: Circle, className: 'text-orange-400' },
];

function StatusBucketDisplay({ buckets }: { buckets: StatusBuckets }) {
  const nonZeroBuckets = STATUS_DISPLAY.filter((s) => buckets[s.key] > 0);

  if (nonZeroBuckets.length === 0) {
    return <span className="text-xs text-th-text-muted">No agents</span>;
  }

  return (
    <div className="flex items-center gap-3" aria-label="Agent status breakdown">
      {nonZeroBuckets.map(({ key, label, icon: Icon, className }) => (
        <span key={key} className="flex items-center gap-1">
          <Icon size={12} className={className} />
          <span className="text-xs text-th-text-alt">
            {buckets[key]} {label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function StatusBar({
  data,
  connectionHealth = 'connected',
  newEventCount = 0,
  onErrorClick,
}: StatusBarProps) {
  const buckets = useMemo(
    () => (data ? computeStatusBuckets(data) : null),
    [data],
  );

  const errorCount = useMemo(
    () => (data ? computeErrorCount(data) : 0),
    [data],
  );

  const overallHealth = useMemo(
    () =>
      buckets
        ? computeOverallHealth(buckets, connectionHealth)
        : connectionHealth === 'offline'
          ? ('red' as const)
          : ('green' as const),
    [buckets, connectionHealth],
  );

  const activeCount = useMemo(
    () => (buckets ? computeActiveCount(buckets) : 0),
    [buckets],
  );

  const narrative = useMemo(
    () => buildNarrativeSentence(activeCount, errorCount),
    [activeCount, errorCount],
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center justify-between gap-4 px-4 py-2 bg-th-bg border-b border-th-border-muted"
      data-testid="status-bar"
    >
      {/* Left: health + buckets */}
      <div className="flex items-center gap-4">
        <HealthIndicator health={overallHealth} />
        {buckets && <StatusBucketDisplay buckets={buckets} />}
      </div>

      {/* Center: narrative sentence (hidden on small screens) */}
      <p className="hidden md:block text-xs text-th-text-muted flex-shrink truncate">
        {narrative}
      </p>

      {/* Right: errors + badges + connection */}
      <div className="flex items-center gap-3">
        {errorCount > 0 && (
          <button
            onClick={onErrorClick}
            className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-red-400 bg-red-900/30 border border-red-800/50 rounded-md hover:bg-red-900/50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:ring-offset-transparent"
            aria-live="assertive"
            aria-label={`${errorCount} ${errorCount === 1 ? 'error' : 'errors'}. Click to view.`}
          >
            <AlertTriangle size={12} />
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </button>
        )}

        {newEventCount > 0 && (
          <span
            className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-400 bg-blue-900/30 border border-blue-800/50 rounded-md"
            aria-label={`${newEventCount} new ${newEventCount === 1 ? 'event' : 'events'} since last visit`}
          >
            {newEventCount} new
          </span>
        )}

        <ConnectionIndicator health={connectionHealth} />
      </div>
    </div>
  );
}
