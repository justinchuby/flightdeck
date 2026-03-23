/**
 * Shared formatting utilities for the Flightdeck UI.
 */
import { shortAgentId } from './agentLabel';

/**
 * Format an agent identifier as `role-xxxx` (role prefix + first 4 hex chars).
 * Falls back to just the first 8 chars if role is empty.
 */
export function formatAgentId(role: string | undefined, id: string): string {
  if (!id) return 'unknown';
  const short = id.slice(0, 4);
  if (!role) return shortAgentId(id);
  return `${role.toLowerCase().split(' ')[0]}-${short}`;
}

/**
 * Format a timestamp as a short time string (e.g., "2:30 PM").
 * Returns '' for falsy input.
 */
export function formatTime(
  ts: string | number | Date | null | undefined,
  opts?: { seconds?: boolean },
): string {
  if (!ts && ts !== 0) return '';
  try {
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...(opts?.seconds ? { second: '2-digit' } : {}),
    });
  } catch {
    return String(ts);
  }
}

/**
 * Format an ISO date as a short date string (e.g., "Mar 8, 2026").
 */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Format an ISO date as a short date + time string (e.g., "Mar 8 2:30 PM").
 */
export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/**
 * Format a timestamp as a full locale string (e.g., "3/8/2026, 2:30:00 PM").
 * Use for detail modals and tooltips where full precision is needed.
 */
export function formatFullTimestamp(ts: string | number | Date): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

/**
 * Format an ISO date string as relative time (e.g., '2 minutes ago').
 * Falls back to the raw string on parse errors.
 */
/**
 * Format a duration in milliseconds as a human-readable string (e.g., "2h 30m", "45s").
 * Returns 'ongoing' for null/undefined input.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return 'ongoing';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff)) return iso;
    if (diff < 0) return 'just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    return `${months} months ago`;
  } catch {
    return iso;
  }
}

/** Format token count in compact form: 1.2k, 45k, 1.2M */
export function formatTokens(count: number | undefined | null): string {
  if (count == null || count === 0) return '0';
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
