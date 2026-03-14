// Runtime utility functions for CrewRoster components
import type { RosterStatus, LiveStatus } from './types';

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function statusBadge(status: RosterStatus, liveStatus: LiveStatus): { bg: string; label: string } {
  // Live agent states take priority — these come from AgentManager (in-memory)
  if (liveStatus === 'running') return { bg: 'bg-green-500/20 text-green-400', label: 'Running' };
  if (liveStatus === 'creating') return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Starting' };
  if (liveStatus === 'idle') return { bg: 'bg-cyan-500/20 text-cyan-400', label: 'Idle' };
  if (liveStatus === 'completed') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Completed' };
  if (liveStatus === 'failed') return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
  if (liveStatus === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  // liveStatus is null — agent not in memory. Fall back to DB status.
  if (status === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  if (status === 'failed') return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
  // DB says idle/running but agent not found in live manager → offline
  return { bg: 'bg-gray-500/20 text-gray-400', label: 'Offline' };
}
