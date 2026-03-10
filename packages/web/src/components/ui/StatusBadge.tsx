/**
 * StatusBadge — Consistent status indicator across Flightdeck.
 *
 * Standardizes the 5 color variants used for agent lifecycle, connectivity,
 * and provider status. Replaces ad-hoc inline badge implementations.
 */
import type { ReactNode } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';
export type StatusSize = 'sm' | 'md';

export interface StatusBadgeProps {
  /** Color variant */
  variant: StatusVariant;
  /** Text label to display */
  label: string;
  /** Size: sm (10px text) or md (11px text). Default: sm */
  size?: StatusSize;
  /** Optional leading icon (e.g., lucide-react element) */
  icon?: ReactNode;
  /** Show only a colored dot with no label */
  dot?: boolean;
  /** Pulse animation on the dot (for active/live statuses) */
  pulse?: boolean;
  /** Additional className */
  className?: string;
}

// ── Variant styles ──────────────────────────────────────────────────

const VARIANT_CLASSES: Record<StatusVariant, string> = {
  success: 'text-green-400 bg-green-400/10',
  warning: 'text-amber-400 bg-amber-400/10',
  error:   'text-red-400 bg-red-400/10',
  info:    'text-blue-400 bg-blue-400/10',
  neutral: 'text-gray-400 bg-gray-400/10',
};

const DOT_CLASSES: Record<StatusVariant, string> = {
  success: 'bg-green-400',
  warning: 'bg-amber-400',
  error:   'bg-red-400',
  info:    'bg-blue-400',
  neutral: 'bg-gray-400',
};

const SIZE_CLASSES: Record<StatusSize, string> = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-[11px] px-2.5 py-1 gap-1.5',
};

const DOT_SIZE: Record<StatusSize, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
};

// ── Component ───────────────────────────────────────────────────────

export function StatusBadge({
  variant,
  label,
  size = 'sm',
  icon,
  dot,
  pulse,
  className = '',
}: StatusBadgeProps) {
  if (dot) {
    return (
      <span
        className={`inline-flex items-center ${SIZE_CLASSES[size]} font-medium rounded-full ${VARIANT_CLASSES[variant]} ${className}`}
        role="status"
        aria-label={label}
        data-testid="status-badge"
      >
        <span className="relative flex">
          {pulse && (
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${DOT_CLASSES[variant]}`}
            />
          )}
          <span className={`relative inline-flex rounded-full ${DOT_SIZE[size]} ${DOT_CLASSES[variant]}`} />
        </span>
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center ${SIZE_CLASSES[size]} font-medium rounded-full ${VARIANT_CLASSES[variant]} ${className}`}
      role="status"
      data-testid="status-badge"
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {label}
    </span>
  );
}

// ── Mapping helpers ─────────────────────────────────────────────────

/** Map common agent statuses to StatusBadge variant + label. */
export function agentStatusProps(
  status: string,
  liveStatus?: string | null,
): { variant: StatusVariant; label: string } {
  // Live agent states take priority — from AgentManager (in-memory)
  if (liveStatus === 'running') return { variant: 'success', label: 'Running' };
  if (liveStatus === 'creating') return { variant: 'warning', label: 'Starting' };
  if (liveStatus === 'idle')    return { variant: 'info', label: 'Idle' };
  if (liveStatus === 'failed')  return { variant: 'error', label: 'Failed' };
  if (liveStatus === 'terminated') return { variant: 'error', label: 'Terminated' };
  if (liveStatus === 'completed')  return { variant: 'neutral', label: 'Completed' };

  // liveStatus is null/undefined — agent not in memory. Fall back to DB status.
  if (status === 'terminated') return { variant: 'error', label: 'Terminated' };
  if (status === 'retired')    return { variant: 'neutral', label: 'Retired' };
  // DB says idle/busy but agent not live → offline
  return { variant: 'neutral', label: 'Offline' };
}

/** Map connectivity states to StatusBadge variant + label. */
export function connectionStatusProps(
  state: string,
): { variant: StatusVariant; label: string } {
  switch (state) {
    case 'connected':    return { variant: 'success', label: 'Online' };
    case 'reconnecting': return { variant: 'warning', label: 'Reconnecting' };
    case 'degraded':     return { variant: 'warning', label: 'Degraded' };
    case 'disconnected': return { variant: 'error', label: 'Disconnected' };
    case 'stopped':      return { variant: 'error', label: 'Stopped' };
    default:             return { variant: 'neutral', label: state };
  }
}

/** Map provider installation/auth state to StatusBadge variant + label. */
export function providerStatusProps(provider: {
  installed: boolean;
  authenticated: boolean | null;
}): { variant: StatusVariant; label: string } {
  if (!provider.installed) return { variant: 'neutral', label: 'Not installed' };
  if (provider.authenticated === true) return { variant: 'success', label: 'Ready' };
  if (provider.authenticated === false) return { variant: 'warning', label: 'Not authenticated' };
  return { variant: 'info', label: 'Installed' };
}

/** Derive project status from agent counts + project status field. */
export function projectStatusProps(project: {
  status: string;
  runningAgentCount?: number;
  idleAgentCount?: number;
  failedAgentCount?: number;
  activeAgentCount?: number;
}): { variant: StatusVariant; label: string; pulse: boolean } {
  if (project.status === 'archived') return { variant: 'neutral', label: 'Archived', pulse: false };

  const running = project.runningAgentCount ?? 0;
  const idle = project.idleAgentCount ?? 0;
  const failed = project.failedAgentCount ?? 0;
  // Fallback for callers that only have activeAgentCount (backward compat)
  const active = running + idle || (project.activeAgentCount ?? 0);

  if (running > 0)  return { variant: 'success', label: 'Active', pulse: true };
  if (idle > 0)     return { variant: 'warning', label: 'Idle', pulse: false };
  if (failed > 0)   return { variant: 'error', label: 'Error', pulse: false };
  if (active > 0)   return { variant: 'success', label: 'Active', pulse: true };
  return { variant: 'neutral', label: 'Stopped', pulse: false };
}
