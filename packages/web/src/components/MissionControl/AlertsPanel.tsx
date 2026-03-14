import { useMemo, useState, useCallback } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../Toast';
import { apiFetch } from '../../hooks/useApi';
import type { DagStatus, Decision } from '../../types';
import type { AgentInfo } from '../../types';
import { shortAgentId } from '../../utils/agentLabel';

// ── Types ────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertAction {
  label: string;
  description: string;
  actionType: 'api_call' | 'dismiss';
  endpoint: string;
  method: 'POST' | 'DELETE';
  body?: Record<string, any>;
  confidence?: number;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  icon: string;
  title: string;
  detail: string;
  timestamp: number;
  agentId?: string;
  actions?: AlertAction[];
}

// ── Detection ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function detectAlerts(
  agents: AgentInfo[],
  decisions: Decision[],
  dagStatus: DagStatus | null,
): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();

  // 1. Pending decisions (>3 min old)
  for (const decision of decisions) {
    if (decision.needsConfirmation && decision.status === 'recorded') {
      const age = now - new Date(decision.timestamp).getTime();
      if (age > 180_000) {
        alerts.push({
          id: `decision-${decision.id}`,
          severity: 'critical',
          icon: '⚠️',
          title: `Decision pending: ${decision.title}`,
          detail: `From ${decision.agentRole}, waiting ${Math.round(age / 60000)} min.`,
          timestamp: new Date(decision.timestamp).getTime(),
        });
      }
    }
  }

  // 4. Failed agents
  for (const agent of agents) {
    if (agent.status === 'failed') {
      const roleName = typeof agent.role === 'object' ? agent.role.name : agent.role;
      alerts.push({
        id: `failed-${agent.id}`,
        severity: 'critical',
        icon: '💥',
        title: `${roleName} failed`,
        detail: `Agent ${shortAgentId(agent.id)} exited with failure status.`,
        timestamp: now,
      });
    }
  }

  // 5. Idle agents alert removed — idle agents don't cost anything (cost is per token),
  // and the Lead assigns tasks, not the human user. This alert was noise.

  // 6. Blocked tasks
  if (dagStatus) {
    const blockedCount = dagStatus.summary?.blocked ?? 0;
    if (blockedCount > 0) {
      alerts.push({
        id: 'blocked-tasks',
        severity: 'warning',
        icon: '🚫',
        title: `${blockedCount} task${blockedCount > 1 ? 's' : ''} blocked`,
        detail: 'Check DAG for dependency issues.',
        timestamp: now,
      });
    }
  }

  return [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ── Rendering ────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<AlertSeverity, { bg: string; border: string; text: string }> = {
  critical: { bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400' },
  warning:  { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-600 dark:text-yellow-400' },
  info:     { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400' },
};

interface AlertsPanelProps {
  leadId: string;
}

const EMPTY_DECISIONS: Decision[] = [];

export function AlertsPanel({ leadId }: AlertsPanelProps) {
  const agents = useAppStore((s) => s.agents);
  const decisions = useLeadStore((s) => s.projects[leadId]?.decisions ?? EMPTY_DECISIONS);
  const dagStatus = useLeadStore((s) => s.projects[leadId]?.dagStatus ?? null);
  const addToast = useToastStore((s) => s.add);
  const [executingAction, setExecutingAction] = useState<string | null>(null);

  const teamAgents = useMemo(
    () => agents.filter((a) => a.parentId === leadId || a.id === leadId),
    [agents, leadId],
  );

  const alerts = useMemo(
    () => detectAlerts(teamAgents, decisions, dagStatus),
    [teamAgents, decisions, dagStatus],
  );

  const executeAction = useCallback(async (alertId: string, action: AlertAction) => {
    // 'dismiss' actions are client-side only — no API call
    if (action.actionType === 'dismiss' || !action.endpoint) return;
    // Validate endpoint starts with /api/ or relative path for safety
    if (!action.endpoint.startsWith('/') && !action.endpoint.startsWith('api/')) {
      addToast('error', `Invalid action endpoint: ${action.endpoint}`);
      return;
    }
    setExecutingAction(`${alertId}-${action.label}`);
    try {
      await apiFetch(action.endpoint, {
        method: action.method,
        body: action.body ? JSON.stringify(action.body) : undefined,
      });
      addToast('success', `${action.label}: done`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `${action.label} failed: ${message}`);
    } finally {
      setExecutingAction(null);
    }
  }, [addToast]);

  if (alerts.length === 0) {
    return (
      <div className="text-center text-th-text-muted text-xs py-6 opacity-60">
        No active alerts
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {alerts.map((alert) => {
        const style = SEVERITY_STYLES[alert.severity];
        return (
          <div
            key={alert.id}
            className={`flex items-start gap-2 px-3 py-2 rounded-md border transition-all duration-200 ${style.bg} ${style.border}`}
          >
            <span className="text-sm flex-shrink-0">{alert.icon}</span>
            <div className="min-w-0 flex-1">
              <span className={`text-xs font-medium ${style.text}`}>{alert.title}</span>
              <p className="text-[11px] text-th-text-muted leading-tight">{alert.detail}</p>
              {/* Actionable buttons */}
              {alert.actions && alert.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {alert.actions.map((action) => {
                    const isExecuting = executingAction === `${alert.id}-${action.label}`;
                    return (
                      <button
                        key={action.label}
                        onClick={() => executeAction(alert.id, action)}
                        disabled={isExecuting}
                        title={action.description}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                          isExecuting
                            ? 'opacity-50 cursor-wait'
                            : 'bg-th-bg/50 border-th-border/50 text-th-text-muted hover:text-th-text-alt hover:border-th-border-hover'
                        }`}
                      >
                        {isExecuting ? '...' : action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
