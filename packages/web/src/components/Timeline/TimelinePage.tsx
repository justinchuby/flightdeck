import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  api: any;
  ws: any;
}

interface TimelineData {
  agents: Array<{
    agentId: string;
    role: string;
    segments: Array<{ status: string; startAt: string; endAt?: string }>;
  }>;
  communications: Array<{
    fromAgentId: string;
    toAgentId: string;
    timestamp: string;
    type: string;
    summary: string;
  }>;
  locks: Array<{
    agentId: string;
    filePath: string;
    acquiredAt: string;
    releasedAt?: string;
  }>;
  timeRange: { start: string; end: string };
}

/** Timeline visualization page — shows agent activity over time using visx. */
export function TimelinePage({ api, ws }: Props) {
  const agents = useAppStore((s) => s.agents);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTimeline = useCallback(async () => {
    try {
      const data = await apiFetch('/coordination/timeline');
      setTimelineData(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load timeline data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Team Collaboration Timeline</h1>
      </div>

      {loading && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 min-h-[400px] flex items-center justify-center">
          <p className="text-zinc-500 text-sm">Loading timeline data…</p>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 rounded-lg border border-red-800 p-4">
          <p className="text-red-400 text-sm">Error: {error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 min-h-[400px] flex items-center justify-center">
          <p className="text-zinc-500 text-sm">
            Timeline visualization — implementation pending.
            <br />
            {timelineData
              ? `${timelineData.agents.length} agents, ${timelineData.communications.length} communications loaded.`
              : 'No data available.'}
          </p>
        </div>
      )}
    </div>
  );
}
