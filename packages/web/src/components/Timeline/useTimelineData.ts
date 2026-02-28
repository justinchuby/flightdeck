import { useState, useEffect, useCallback } from 'react';

// --- Data interfaces ---

export interface TimelineSegment {
  status: string;
  startAt: string;
  endAt: string;
}

export interface TimelineAgent {
  id: string;
  shortId: string;
  role: string;
  createdAt: string;
  endedAt: string | null;
  segments: TimelineSegment[];
}

export interface TimelineCommunication {
  type: string;
  fromAgentId: string;
  toAgentId: string;
  summary: string;
  timestamp: string;
}

export interface TimelineLock {
  agentId: string;
  filePath: string;
  acquiredAt: string;
  releasedAt: string | null;
}

export interface TimelineData {
  agents: TimelineAgent[];
  communications: TimelineCommunication[];
  locks: TimelineLock[];
  timeRange: { start: string; end: string };
}

// --- Hook ---

const POLL_INTERVAL_MS = 10_000;

export function useTimelineData(projectId?: string) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);

      const url = `/api/coordination/timeline${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url);
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
  }, [projectId]);

  // Initial fetch + polling
  useEffect(() => {
    setLoading(true);
    fetchTimeline();
    const interval = setInterval(fetchTimeline, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTimeline]);

  return { data, loading, error, refetch: fetchTimeline };
}
