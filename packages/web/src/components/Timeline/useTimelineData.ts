import { useState, useEffect, useCallback, useRef } from 'react';
import { useTimelineSSE } from './useTimelineSSE';
import type { ConnectionHealth } from './useTimelineSSE';

export type { ConnectionHealth };

// --- Data interfaces ---

export type TimelineStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';
export type CommType = 'delegation' | 'message' | 'group_message' | 'broadcast';

export type AgentRole =
  | 'architect'
  | 'developer'
  | 'code-reviewer'
  | 'critical-reviewer'
  | 'product-manager'
  | 'technical-writer'
  | 'tech-writer'
  | 'designer'
  | 'generalist'
  | 'secretary'
  | 'qa-tester'
  | 'radical-thinker'
  | 'project-lead'
  | 'agent'
  | string;

export interface TimelineSegment {
  status: TimelineStatus;
  startAt: string;
  endAt?: string;
  taskLabel?: string;
}

export interface TimelineAgent {
  id: string;
  shortId: string;
  role: string;
  model?: string;
  provider?: string;
  sessionId?: string;
  createdAt: string;
  endedAt?: string;
  segments: TimelineSegment[];
}

export interface TimelineComm {
  type: CommType;
  fromAgentId: string;
  toAgentId?: string;
  groupName?: string;
  summary: string;
  timestamp: string;
}

export interface TimelineLock {
  agentId: string;
  filePath: string;
  acquiredAt: string;
  releasedAt?: string;
}

export interface TimelineData {
  agents: TimelineAgent[];
  communications: TimelineComm[];
  locks: TimelineLock[];
  timeRange: { start: string; end: string };
  sessionId?: string;
  /** Ledger version — increments on prune/reorder/clear; use for cache invalidation */
  ledgerVersion?: number;
}

// --- Helpers ---

export function getLocksForAgent(locks: TimelineLock[], agentId: string): TimelineLock[] {
  return locks.filter(l => l.agentId === agentId);
}

// --- Polling fallback hook ---

const POLL_INTERVAL_MS = 5_000;

function useTimelinePolling(leadId: string | null, enabled: boolean) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async () => {
    if (!leadId || !enabled) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/coordination/timeline?leadId=${leadId}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const json: TimelineData = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch timeline');
    } finally {
      setLoading(false);
    }
  }, [leadId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchTimeline();
    const interval = setInterval(fetchTimeline, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTimeline, enabled]);

  return { data, loading, error, refetch: fetchTimeline };
}

// --- Main hook: SSE preferred, polling fallback ---

export function useTimelineData(leadId: string | null) {
  const sse = useTimelineSSE(leadId);
  const polling = useTimelinePolling(leadId, sse.sseUnavailable);
  const lastKnownGoodRef = useRef<TimelineData | null>(null);

  const liveData = sse.sseUnavailable ? polling.data : sse.data;

  // Preserve last known good data during SSE→polling transitions to avoid data=null flash
  if (liveData) lastKnownGoodRef.current = liveData;
  const data = liveData ?? lastKnownGoodRef.current;

  const loading = sse.sseUnavailable ? polling.loading : sse.loading;
  const error = sse.sseUnavailable ? (polling.error ?? sse.error) : sse.error;

  const connectionHealth: ConnectionHealth = sse.sseUnavailable
    ? (polling.error ? 'degraded' : polling.data ? 'connected' : 'connecting')
    : sse.connectionHealth;

  const refetch = sse.sseUnavailable ? polling.refetch : async () => { sse.reconnect(); };

  return { data, loading, error, refetch, connectionHealth };
}
