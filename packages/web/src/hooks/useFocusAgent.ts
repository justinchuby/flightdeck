import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import { POLL_INTERVAL_MS } from '../constants/timing';
import type { AgentInfo, Decision } from '../types';

// ── Types ────────────────────────────────────────────────────────────

export interface FileDiff {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  additions: number;
  deletions: number;
  diff: string;
}

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface DiffResult {
  agentId: string;
  files: FileDiff[];
  summary: DiffSummary;
  cachedAt: string;
}

interface Activity {
  id: string;
  action: string;
  agentId?: string;
  details?: string;
  timestamp: string;
}

interface FileLock {
  filePath: string;
  agentId: string;
  lockedAt: string;
}

export interface FocusAgentData {
  agent: AgentInfo;
  recentOutput: string;
  activities: Activity[];
  decisions: Decision[];
  fileLocks: FileLock[];
  diff: DiffResult | null;
}

interface UseFocusAgentResult {
  data: FocusAgentData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Fetches aggregated agent data from GET /api/agents/:id/focus.
 * Auto-refreshes on an interval (default 10s). Call refresh() for immediate update.
 */
export function useFocusAgent(
  agentId: string | null,
  { pollInterval = POLL_INTERVAL_MS }: { pollInterval?: number } = {},
): UseFocusAgentResult {
  const [data, setData] = useState<FocusAgentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Incremented on each agent switch to discard stale in-flight responses
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!agentId) return;
    const requestId = requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<FocusAgentData>(`/agents/${agentId}/focus`);
      if (requestIdRef.current === requestId) setData(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (requestIdRef.current === requestId) setError(message ?? 'Failed to load agent data');
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [agentId]);

  // Initial fetch + polling — bump requestId on agent switch to invalidate stale responses
  useEffect(() => {
    requestIdRef.current++;
    if (!agentId) {
      setData(null);
      return;
    }
    fetchData();
    const timer = setInterval(fetchData, pollInterval);
    return () => {
      clearInterval(timer);
    };
  }, [agentId, pollInterval, fetchData]);

  return { data, loading, error, refresh: fetchData };
}

// ── Standalone diff summary hook (lightweight, for badges) ───────────

export interface DiffSummaryResult {
  summary: DiffSummary | null;
  loading: boolean;
}

export function useDiffSummary(
  agentId: string | null,
  { pollInterval = POLL_INTERVAL_MS }: { pollInterval?: number } = {},
): DiffSummaryResult {
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current++;
    const currentId = requestIdRef.current;
    if (!agentId) {
      setSummary(null);
      return;
    }

    const fetch_ = async () => {
      setLoading(true);
      try {
        const result = await apiFetch<{ filesChanged: number; additions: number; deletions: number }>(
          `/agents/${agentId}/diff/summary`,
        );
        if (requestIdRef.current === currentId) {
          setSummary({
            filesChanged: result.filesChanged,
            additions: result.additions,
            deletions: result.deletions,
          });
        }
      } catch {
        // Silently ignore — badge just stays empty
      } finally {
        if (requestIdRef.current === currentId) setLoading(false);
      }
    };

    fetch_();
    const timer = setInterval(fetch_, pollInterval);
    return () => {
      clearInterval(timer);
    };
  }, [agentId, pollInterval]);

  return { summary, loading };
}
