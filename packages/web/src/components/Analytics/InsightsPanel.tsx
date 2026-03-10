import { useState } from 'react';
import type { AnalyticsInsight } from './types';
import { InsightCard } from './InsightCard';

interface InsightsPanelProps {
  insights: AnalyticsInsight[];
}

export function InsightsPanel({ insights }: InsightsPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? insights : insights.slice(0, 3);

  if (insights.length === 0) {
    return (
      <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="insights-panel">
        <h3 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide mb-2">💡 Insights</h3>
        <p className="text-xs text-th-text-muted">Complete more sessions to generate insights.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="insights-panel">
      <h3 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide mb-3">💡 Insights</h3>
      <div className="space-y-2">
        {visible.map((insight) => (
          <InsightCard key={`${insight.type}-${insight.title}`} insight={insight} />
        ))}
      </div>
      {insights.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[11px] text-accent hover:underline mt-2"
        >
          {showAll ? 'Show less' : `Show ${insights.length - 3} more`}
        </button>
      )}
    </div>
  );
}
