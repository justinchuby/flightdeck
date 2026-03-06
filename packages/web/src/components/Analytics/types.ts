// Analytics data types — aligned with backend AnalyticsService response shapes

export interface SessionSummary {
  leadId: string;
  projectId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  agentCount: number;
  taskCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface AnalyticsOverview {
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessions: SessionSummary[];
  roleContributions: Array<{ role: string; taskCount: number; tokenUsage: number }>;
}

export interface SessionComparison {
  sessions: SessionSummary[];
  deltas: {
    tokenDelta: number;
    agentCountDelta: number;
  } | null;
}

export interface AnalyticsInsight {
  type: 'cost' | 'efficiency' | 'model' | 'role' | 'playbook' | 'anomaly';
  severity: 'info' | 'suggestion' | 'warning';
  title: string;
  description: string;
  actionable?: { label: string; action: string };
}

export type TimeWindow = '7d' | '30d' | '90d' | 'all';

// ── Insight generator (template-based, no LLM) ─────────────────

export function generateInsights(overview: AnalyticsOverview): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];
  const sessions = overview.sessions;
  if (sessions.length < 2) return insights;

  // Token usage trend
  const recent = sessions.slice(0, 5);
  const older = sessions.slice(5, 10);
  if (recent.length >= 3 && older.length >= 2) {
    const recentAvg = recent.reduce((s, x) => s + x.totalInputTokens + x.totalOutputTokens, 0) / recent.length;
    const olderAvg = older.reduce((s, x) => s + x.totalInputTokens + x.totalOutputTokens, 0) / older.length;
    const pctChange = ((recentAvg - olderAvg) / olderAvg) * 100;
    if (pctChange < -10) {
      insights.push({
        type: 'cost',
        severity: 'info',
        title: 'Sessions using fewer tokens',
        description: `Token usage down ${Math.abs(Math.round(pctChange))}% over recent sessions.`,
      });
    } else if (pctChange > 20) {
      insights.push({
        type: 'cost',
        severity: 'warning',
        title: 'Token usage increasing',
        description: `Sessions use ${Math.round(pctChange)}% more tokens than earlier. Review agent count and models.`,
      });
    }
  }

  // High completion rate
  const totalTasks = sessions.reduce((s, x) => s + x.taskCount, 0);
  if (totalTasks > 10) {
    insights.push({
      type: 'efficiency',
      severity: 'info',
      title: `${totalTasks} tasks across ${sessions.length} sessions`,
      description: `Averaging ${(totalTasks / sessions.length).toFixed(1)} tasks per session.`,
    });
  }

  // Role balance
  const { roleContributions } = overview;
  if (roleContributions.length > 0) {
    const top = roleContributions[0];
    const topPct = Math.round(
      (top.taskCount / roleContributions.reduce((s, r) => s + r.taskCount, 0)) * 100,
    );
    if (topPct > 60) {
      insights.push({
        type: 'role',
        severity: 'suggestion',
        title: `${top.role} handles ${topPct}% of tasks`,
        description: 'Consider adding more agents in other roles for better distribution.',
      });
    }
  }

  return insights.slice(0, 5);
}
