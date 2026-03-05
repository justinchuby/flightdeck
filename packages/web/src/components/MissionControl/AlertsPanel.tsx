import { useMemo, useState, useCallback } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../Toast';
import { apiFetch } from '../../hooks/useApi';
import type { DagStatus, Decision } from '../../types';
import type { AgentInfo } from '../../types';

// ── Types ────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertAction {
  label: string;
  description: string;
  actionType: 'api_call' | 'dismiss';
  endpoint: string;
  method: 'POST' | 'DELETE' | 'PATCH';
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

  // 1. Context pressure (>85% critical, >70% warning) — with actionable options
  for (const agent of agents) {
    if (agent.contextWindowSize && agent.contextWindowUsed) {
      const pct = agent.contextWindowUsed / agent.contextWindowSize;
      const roleName = typeof agent.role === 'object' ? agent.role.name : agent.role;
      const shortId = agent.id.slice(0, 8);
      const burnLabel = agent.contextBurnRate && agent.contextBurnRate > 0
        ? ` • ~${Math.round(agent.contextBurnRate * 60)}k tok/min`
        : '';
      const timeLabel = agent.estimatedExhaustionMinutes != null && agent.estimatedExhaustionMinutes > 0
        ? ` • ~${Math.round(agent.estimatedExhaustionMinutes)} min remaining`
        : '';

      const actions: AlertAction[] = [
        {
          label: 'Compress context',
          description: 'Restart agent with context handoff',
          actionType: 'api_call',
          endpoint: `/agents/${agent.id}/restart`,
          method: 'POST',
        },
        {
          label: 'Switch model',
          description: 'Change to a model with larger context window',
          actionType: 'api_call',
          endpoint: `/agents/${agent.id}`,
          method: 'PATCH',
          body: { model: 'claude-opus-4.6-1m' },
        },
      ];

      if (pct > 0.85) {
        alerts.push({
          id: `ctx-${agent.id}`,
          severity: 'critical',
          icon: '🧠',
          title: `${roleName} at ${Math.round(pct * 100)}% context`,
          detail: `Agent ${shortId} may produce lower quality output.${burnLabel}${timeLabel}`,
          agentId: agent.id,
          timestamp: now,
          actions,
        });
      } else if (pct > 0.70) {
        alerts.push({
          id: `ctx-warn-${agent.id}`,
          severity: 'warning',
          icon: '🧠',
          title: `${roleName} at ${Math.round(pct * 100)}% context`,
          detail: `Agent ${shortId} approaching context limit.${burnLabel}${timeLabel}`,
          agentId: agent.id,
          timestamp: now,
          actions,
        });
      }

      // Proactive burn-rate alert: <10 min remaining but not yet >70% context
      if (pct <= 0.70 && agent.estimatedExhaustionMinutes != null && agent.estimatedExhaustionMinutes <= 10) {
        alerts.push({
          id: `burn-${agent.id}`,
          severity: agent.estimatedExhaustionMinutes <= 5 ? 'critical' : 'warning',
          icon: '🔥',
          title: `${roleName} burning context fast`,
          detail: `Agent ${shortId}: ~${Math.round(agent.estimatedExhaustionMinutes)} min until exhaustion at current rate.`,
          agentId: agent.id,
          timestamp: now,
          actions,
        });
      }
    }
  }

  // 2. Stuck agents (running >10 min since creation with no indication of progress)
  for (const agent of agents) {
    if (agent.status === 'running' && agent.createdAt) {
      const runningMs = now - new Date(agent.createdAt).getTime();
      if (runningMs > 600_000) {
        const roleName = typeof agent.role === 'object' ? agent.role.name : agent.role;
        alerts.push({
          id: `stuck-${agent.id}`,
          severity: 'warning',
          icon: '⏱️',
          title: `${roleName} may be stuck`,
          detail: `Running for ${Math.round(runningMs / 60000)} min with no completion.`,
          timestamp: now,
        });
      }
    }
  }

  // 3. Pending decisions (>3 min old)
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
        detail: `Agent ${agent.id.slice(0, 8)} exited with failure status.`,
        timestamp: now,
      });
    }
  }

  // 5. Idle agents with ready DAG tasks
  if (dagStatus) {
    const readyTasks = dagStatus.tasks.filter(t => t.dagStatus === 'ready');
    const idleAgents = agents.filter(a => a.status === 'idle');
    if (readyTasks.length > 0 && idleAgents.length > 0) {
      alerts.push({
        id: 'idle-with-ready',
        severity: 'info',
        icon: '💡',
        title: `${readyTasks.length} tasks ready, ${idleAgents.length} agents idle`,
        detail: 'Consider assigning ready tasks to idle agents.',
        timestamp: now,
      });
    }
  }

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

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
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
    } catch (err: any) {
      addToast('error', `${action.label} failed: ${err.message}`);
    } finally {
      setExecutingAction(null);
    }
  }, [addToast]);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {alerts.map((alert) => {
        const style = SEVERITY_STYLES[alert.severity];
        return (
          <div
            key={alert.id}
            className={`flex items-start gap-2 px-3 py-2 rounded-md border ${style.bg} ${style.border}`}
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
