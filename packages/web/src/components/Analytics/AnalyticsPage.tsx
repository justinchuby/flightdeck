import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { TimeWindowSelector } from './TimeWindowSelector';
import { SessionOverviewCard } from './SessionOverviewCard';
import { CostTrendChart } from './CostTrendChart';
import { InsightsPanel } from './InsightsPanel';
import { SessionHistoryTable } from './SessionHistoryTable';
import { SessionComparisonView } from './SessionComparisonView';
import { EmptyState } from '../ui/EmptyState';
import {
  generateInsights,
  type AnalyticsOverview,
  type SessionComparison,
  type TimeWindow,
} from './types';

const EMPTY_OVERVIEW: AnalyticsOverview = {
  totalSessions: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  sessions: [],
  roleContributions: [],
};

export function AnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('30d');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<SessionComparison | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AnalyticsOverview>('/analytics');
      setOverview(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message ?? 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Filter sessions by time window
  const filteredOverview = useMemo(() => {
    if (timeWindow === 'all') return overview;
    const now = Date.now();
    const cutoff = {
      '7d': now - 7 * 86_400_000,
      '30d': now - 30 * 86_400_000,
      '90d': now - 90 * 86_400_000,
    }[timeWindow];

    const filtered = overview.sessions.filter(
      (s) => new Date(s.startedAt).getTime() >= cutoff,
    );
    return {
      ...overview,
      sessions: filtered,
      totalSessions: filtered.length,
    };
  }, [overview, timeWindow]);

  const insights = useMemo(() => generateInsights(filteredOverview), [filteredOverview]);

  // Compare sessions
  const toggleCompare = useCallback((leadId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(leadId)) return prev.filter((id) => id !== leadId);
      if (prev.length >= 2) return [prev[1], leadId]; // replace oldest
      return [...prev, leadId];
    });
  }, []);

  const fetchComparison = useCallback(async () => {
    if (compareIds.length < 2) {
      setComparison(null);
      return;
    }
    try {
      const data = await apiFetch<SessionComparison>(
        `/analytics/compare?sessions=${compareIds.join(',')}`,
      );
      setComparison(data);
    } catch {
      setComparison(null);
    }
  }, [compareIds]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  // Loading state
  if (loading && overview.totalSessions === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-3xl mb-2">📊</div>
          <p className="text-sm text-th-text-muted">Loading analytics...</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!loading && overview.totalSessions === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" data-testid="analytics-empty">
        <EmptyState
          icon="📊"
          title="No sessions yet"
          description="Complete a few sessions to start seeing analytics. Token trends, model effectiveness, and insights will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="analytics-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-th-text-alt">📊 Analytics</h2>
        <div className="flex items-center gap-2">
          <TimeWindowSelector value={timeWindow} onChange={setTimeWindow} />
          {compareIds.length === 2 && (
            <span className="text-[10px] text-accent px-2 py-0.5 bg-accent/10 rounded">
              Comparing {compareIds.length} sessions
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Top row: Overview + Token Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SessionOverviewCard overview={filteredOverview} />
        <CostTrendChart overview={filteredOverview} />
      </div>

      {/* Insights */}
      <InsightsPanel insights={insights} />

      {/* Comparison (if active) */}
      {comparison && (
        <SessionComparisonView
          comparison={comparison}
          onClose={() => {
            setCompareIds([]);
            setComparison(null);
          }}
        />
      )}

      {/* Session History */}
      <SessionHistoryTable
        sessions={filteredOverview.sessions}
        selectedIds={compareIds}
        onToggleCompare={toggleCompare}
      />
    </div>
  );
}
