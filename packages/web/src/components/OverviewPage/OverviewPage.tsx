/**
 * OverviewPage — Project Command Center.
 *
 * Answers: "What needs my attention right now?"
 * - Quick Status Bar — running/stopped, agent count, task progress, duration
 * - Accumulated Stats — cross-session agent/task/decision totals
 * - Session Controls — start/stop/resume
 * - Attention Items — alerts from detectAlerts (failed agents, pending decisions, blocked tasks)
 * - Two-column feed: Decisions + Progress (including milestones)
 * - Session History (prominent, always visible)
 *
 * Data sources:
 * - REST APIs (projectId-scoped): decisions, activity, locks — cross-session
 * - LeadStore (WebSocket): dagStatus — current active session only
 *
 * All visualization charts moved to AnalysisPage.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore, resolveProject } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { useProjects } from '../../hooks/useProjects';
import { useProjectId } from '../../contexts/ProjectContext';
import { formatDateTime } from '../../utils/format';
import { POLL_INTERVAL_MS } from '../../constants/timing';
import { SessionHistory, NewSessionDialog } from '../SessionHistory';
import { detectAlerts, type AlertSeverity } from '../MissionControl/AlertsPanel';
import {
  DecisionFeedItem,
  DecisionDetailModal,
  ActivityFeedItem,
  ActivityDetailModal,
} from '../Shared';
import type { ActivityEntry } from '../Shared';
import { SectionErrorBoundary } from '../SectionErrorBoundary';
import {
  Square,
  Plus,
  Users,
  Clock,
  Crown,
  Loader2,
  AlertTriangle,
  FolderOpen,
  Pencil,
  Check,
  X,
  History,
} from 'lucide-react';
import type { Decision } from '../../types';
import { TokenUsageSection } from './TokenUsageSection';
import { FileLockPanel } from '../FleetOverview/FileLockPanel';
import type { FileLock } from '../FleetOverview/FleetOverview';


// ── Constants ──────────────────────────────────────────────────────

const SEVERITY_BG: Record<AlertSeverity, string> = {
  critical: 'bg-red-500/10 border border-red-500/20',
  warning: 'bg-amber-500/10 border border-amber-500/20',
  info: 'bg-blue-500/10 border border-blue-500/20',
};

// ── Component ──────────────────────────────────────────────────────

export function OverviewPage() {
  const agents = useAppStore((s) => s.agents);
  const { projects } = useProjects();
  const effectiveId = useProjectId();
  const navigate = useNavigate();

  const projectName = useMemo(() => {
    if (!effectiveId) return '';
    const proj = projects.find(p => p.id === effectiveId);
    if (proj) return proj.name;
    const lead = agents.find(a => a.projectId === effectiveId && a.role?.id === 'lead');
    return lead?.projectName ?? effectiveId.slice(0, 12);
  }, [effectiveId, projects, agents]);

  const hasActiveLead = useMemo(() => {
    return agents.some(a => a.role?.id === 'lead' && a.projectId === effectiveId &&
      (a.status === 'running' || a.status === 'idle'));
  }, [agents, effectiveId]);

  const activeLeadAgent = useMemo(() => {
    if (!hasActiveLead || !effectiveId) return null;
    return agents.find(a => a.role?.id === 'lead' && a.projectId === effectiveId &&
      (a.status === 'running' || a.status === 'idle')) ?? null;
  }, [agents, effectiveId, hasActiveLead]);

  const projectAgents = useMemo(() => {
    if (!effectiveId) return [];
    return agents.filter(a => a.projectId === effectiveId && (a.status === 'running' || a.status === 'idle'));
  }, [agents, effectiveId]);

  // ── Session controls state ────────────────────────────────────
  const [stopping, setStopping] = useState(false);
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);

  // ── Project directory state ──────────────────────────────────
  const currentProject = useMemo(() => {
    if (!effectiveId) return null;
    return projects.find(p => p.id === effectiveId) ?? null;
  }, [effectiveId, projects]);

  const [editingCwd, setEditingCwd] = useState(false);
  const [cwdValue, setCwdValue] = useState('');
  const [cwdSaving, setCwdSaving] = useState(false);
  const [cwdError, setCwdError] = useState<string | null>(null);

  const handleEditCwd = useCallback(() => {
    setCwdValue(currentProject?.cwd || '');
    setCwdError(null);
    setEditingCwd(true);
  }, [currentProject]);

  const handleCancelCwdEdit = useCallback(() => {
    setEditingCwd(false);
    setCwdError(null);
  }, []);

  const handleSaveCwd = useCallback(async () => {
    if (!effectiveId) return;
    setCwdSaving(true);
    setCwdError(null);
    try {
      await apiFetch(`/projects/${effectiveId}`, {
        method: 'PATCH',
        body: JSON.stringify({ cwd: cwdValue.trim() || null }),
      });
      setEditingCwd(false);
    } catch (err) {
      setCwdError(err instanceof Error ? err.message : 'Failed to update directory');
    } finally {
      setCwdSaving(false);
    }
  }, [effectiveId, cwdValue]);

  const handleStopSession = useCallback(async () => {
    if (!effectiveId) return;
    setStopping(true);
    try {
      await apiFetch(`/projects/${effectiveId}/stop`, { method: 'POST' });
    } catch { /* ignore */ }
    finally { setStopping(false); }
  }, [effectiveId]);

  // ── Live session data (current session DAG from LeadStore) ─────
  const activeLeadId = activeLeadAgent?.id ?? null;
  const dagStatus = useLeadStore(s => {
    const proj = resolveProject(s, activeLeadId) ?? resolveProject(s, effectiveId);
    return proj?.dagStatus ?? null;
  });

  // ── Decisions feed ────────────────────────────────────────────
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<{ entry: ActivityEntry; projectName: string } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!effectiveId) return;
    mountedRef.current = true;
    const poll = async () => {
      try {
        const data = await apiFetch<Decision[]>(`/decisions?projectId=${effectiveId}`);
        if (mountedRef.current) setDecisions(Array.isArray(data) ? data : []);
      } catch { /* API may not be ready */ }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [effectiveId]);

  const actionableDecisions = useMemo(() =>
    decisions.filter(d => d.status === 'recorded' && d.needsConfirmation),
    [decisions],
  );

  // ── Attention alerts (cross-session: uses REST decisions) ─────
  const alerts = useMemo(
    () => detectAlerts(projectAgents, decisions, dagStatus),
    [projectAgents, decisions, dagStatus],
  );

  // ── Activity feed (progress feed display) ──
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  // ── Accumulated stats from summary endpoint (not limited by activity page size) ──
  interface SummaryData {
    totalActions: number;
    byAgent: Record<string, number>;
    byType: Record<string, number>;
    recentFiles: string[];
  }
  const [summary, setSummary] = useState<SummaryData | null>(null);

  // ── File locks ──
  const [locks, setLocks] = useState<FileLock[]>([]);

  useEffect(() => {
    if (!effectiveId) return;
    const poll = async () => {
      try {
        const data = await apiFetch<{ locks: FileLock[] }>(
          `/coordination/status?projectId=${effectiveId}`,
        );
        if (mountedRef.current) setLocks(Array.isArray(data.locks) ? data.locks : []);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [effectiveId]);

  useEffect(() => {
    if (!effectiveId) return;
    const poll = async () => {
      try {
        const data = await apiFetch<ActivityEntry[]>(
          `/coordination/activity?projectId=${effectiveId}&limit=200`,
        );
        if (mountedRef.current) setActivity(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [effectiveId]);

  useEffect(() => {
    if (!effectiveId) return;
    const poll = async () => {
      try {
        const data = await apiFetch<SummaryData>(
          `/coordination/summary?projectId=${effectiveId}`,
        );
        if (mountedRef.current && data && typeof data === 'object' && !Array.isArray(data)) setSummary(data);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [effectiveId]);

  // ── Derived data: progress feed + accumulated stats ────────────
  const progressActivity = useMemo(
    () => activity.filter(a => a.actionType === 'progress_update'),
    [activity],
  );

  const accumulatedStats = useMemo(() => {
    const totalAgents = summary?.byAgent ? Object.keys(summary.byAgent).length : 0;
    const totalTasksCompleted = summary?.byType?.task_completed ?? 0;
    return { totalAgents, totalTasksCompleted, totalDecisions: decisions.length };
  }, [summary, decisions]);

  const hasAccumulatedData = accumulatedStats.totalAgents > 0 ||
    accumulatedStats.totalDecisions > 0 ||
    accumulatedStats.totalTasksCompleted > 0;

  // ── Quick status bar data (current session) ───────────────────
  const tasksDone = dagStatus?.summary?.done ?? 0;
  const tasksTotal = dagStatus?.summary
    ? dagStatus.summary.done + dagStatus.summary.running + dagStatus.summary.ready +
      dagStatus.summary.pending + dagStatus.summary.failed + dagStatus.summary.blocked +
      dagStatus.summary.paused + dagStatus.summary.skipped
    : 0;

  // ── Render ────────────────────────────────────────────────────

  if (!effectiveId && projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-th-text-muted text-sm">
        No session data yet. Start a project to see the overview.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4" data-testid="overview-page">
      <div className="px-4 pt-2 space-y-4">

      {/* ── Quick Status Bar ───────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-2 bg-surface-raised border border-th-border rounded-lg text-sm text-th-text-muted" data-testid="quick-status-bar">
        <span className={hasActiveLead ? 'text-green-600 dark:text-green-400' : projectAgents.length > 0 ? 'text-orange-500' : 'text-red-600 dark:text-red-400'}>
          {hasActiveLead ? '● Running' : projectAgents.length > 0 ? '● No Lead' : '● Stopped'}
        </span>
        <span>{projectAgents.length} agent{projectAgents.length !== 1 ? 's' : ''}</span>
        {tasksTotal > 0 && <span>{tasksDone}/{tasksTotal} tasks</span>}
        {activeLeadAgent?.createdAt && (
          <span className="flex items-center gap-1">
            <Clock size={12} />
            Started {formatDateTime(activeLeadAgent.createdAt)}
          </span>
        )}
      </div>

      {/* ── Accumulated Project Stats (all sessions) ──────────── */}
      {hasAccumulatedData && (
        <div
          className="flex items-center gap-4 px-4 py-1.5 bg-th-bg/50 border border-th-border/50 rounded-md text-xs text-th-text-muted"
          data-testid="accumulated-stats"
        >
          <span className="font-medium text-th-text-alt">All Sessions</span>
          {accumulatedStats.totalAgents > 0 && (
            <span>{accumulatedStats.totalAgents} agent{accumulatedStats.totalAgents !== 1 ? 's' : ''} total</span>
          )}
          {accumulatedStats.totalTasksCompleted > 0 && (
            <span>{accumulatedStats.totalTasksCompleted} task{accumulatedStats.totalTasksCompleted !== 1 ? 's' : ''} completed</span>
          )}
          {accumulatedStats.totalDecisions > 0 && (
            <span>{accumulatedStats.totalDecisions} decision{accumulatedStats.totalDecisions !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* ── Session Controls ───────────────────────────────────── */}
      {effectiveId && hasActiveLead && activeLeadAgent && (
        <div
          className="bg-surface-raised border border-th-border rounded-lg p-4 cursor-pointer hover:border-yellow-500/50 transition-colors"
          data-testid="active-session-banner"
          onClick={() => navigate(`/projects/${effectiveId}/session`)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Crown className="w-5 h-5 text-yellow-500" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              </div>
              <div>
                <div className="text-sm font-medium text-th-text">Active Session</div>
                <div className="text-xs text-th-text-muted flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Users size={11} />
                    {projectAgents.length} agent{projectAgents.length !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    Started {formatDateTime(activeLeadAgent.createdAt ?? '')}
                  </span>
                  {activeLeadAgent.task && (
                    <span className="truncate max-w-xs" title={activeLeadAgent.task}>
                      · {activeLeadAgent.task}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleStopSession(); }}
              disabled={stopping}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/20 text-red-600 dark:text-red-400 rounded-md hover:bg-red-500/30 transition-colors font-medium disabled:opacity-50"
              data-testid="stop-session-btn"
            >
              {stopping ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
              {stopping ? 'Stopping…' : 'Stop Session'}
            </button>
          </div>
        </div>
      )}

      {effectiveId && !hasActiveLead && (
        <div className="flex items-center gap-3" data-testid="no-session-controls">
          <button
            type="button"
            onClick={() => setShowNewSessionDialog(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-accent hover:bg-accent/80 text-white rounded-md transition-colors font-medium"
            data-testid="new-session-btn"
          >
            <Plus size={14} />
            New Session
          </button>
          <span className="text-xs text-th-text-muted">
            No active session. Start a new one or resume from history below.
          </span>
        </div>
      )}

      {/* ── Project Directory ──────────────────────────────────── */}
      {currentProject && (
        <div className="bg-surface-raised border border-th-border rounded-lg px-4 py-3" data-testid="project-directory">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen size={14} className="text-th-text-muted" />
            <span className="text-xs font-medium text-th-text-muted uppercase tracking-wide">Working Directory</span>
          </div>
          {editingCwd ? (
            <div className="flex items-center gap-1.5">
              <input
                value={cwdValue}
                onChange={(e) => setCwdValue(e.target.value)}
                className="flex-1 text-sm font-mono bg-th-bg border border-th-border rounded px-2 py-1 text-th-text-alt focus:outline-none focus:border-accent"
                placeholder="/path/to/project"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCwd();
                  if (e.key === 'Escape') handleCancelCwdEdit();
                }}
                data-testid="cwd-input"
              />
              <button
                onClick={handleSaveCwd}
                disabled={cwdSaving}
                className="p-1 text-green-500 hover:text-green-400 transition-colors disabled:opacity-50"
                title="Save"
                data-testid="cwd-save-btn"
              >
                {cwdSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button
                onClick={handleCancelCwdEdit}
                className="p-1 text-th-text-muted hover:text-th-text transition-colors"
                title="Cancel"
                data-testid="cwd-cancel-btn"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span
                className="text-sm font-mono text-th-text-alt truncate"
                title={currentProject.cwd || 'Not set'}
                data-testid="cwd-display"
              >
                {currentProject.cwd || <span className="text-th-text-muted italic">Not set</span>}
              </span>
              <button
                onClick={handleEditCwd}
                className="p-0.5 text-th-text-muted hover:text-th-text transition-colors rounded"
                title="Edit working directory"
                data-testid="cwd-edit-btn"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          {cwdError && (
            <p className="text-xs text-red-500 mt-1" data-testid="cwd-error">{cwdError}</p>
          )}
        </div>
      )}

      {/* ── Attention Items (only when alerts exist) ───────────── */}
      {alerts.length > 0 && (
        <section className="space-y-2" data-testid="attention-items">
          <h3 className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Attention Required
          </h3>
          {alerts.map(alert => (
            <div key={alert.id} className={`px-3 py-2 rounded-lg text-sm ${SEVERITY_BG[alert.severity]}`}>
              <span>{alert.icon} {alert.title}</span>
              <p className="text-xs text-th-text-muted mt-0.5">{alert.detail}</p>
            </div>
          ))}
        </section>
      )}

      {/* ── File Locks ──────────────────────────────────────────── */}
      {locks.length > 0 && (
        <SectionErrorBoundary name="File locks">
          <FileLockPanel locks={locks} agents={projectAgents} />
        </SectionErrorBoundary>
      )}

      {/* ── Two-Column Feed ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Decisions Feed */}
        <SectionErrorBoundary name="Decisions feed">
        <section className="bg-surface-raised border border-th-border rounded-lg" data-testid="decisions-feed">
          <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider px-4 py-2 border-b border-th-border">
            Decisions
          </h3>
          {actionableDecisions.length === 0 && decisions.length === 0 ? (
            <p className="text-th-text-muted text-sm px-4 py-6 text-center">No decisions yet</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
            <div className="divide-y divide-th-border/30">
              {(actionableDecisions.length > 0 ? actionableDecisions : decisions).map(d => (
                <DecisionFeedItem
                  key={d.id}
                  decision={d}
                  projectName={projectName}
                  onClick={() => setSelectedDecision(d)}
                />
              ))}
            </div>
            </div>
          )}
        </section>
        </SectionErrorBoundary>

        {/* Progress Feed */}
        <SectionErrorBoundary name="Progress feed">
        <section className="bg-surface-raised border border-th-border rounded-lg" data-testid="progress-feed">
          <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider px-4 py-2 border-b border-th-border">
            Recent Progress
          </h3>
          {progressActivity.length === 0 ? (
            <p className="text-th-text-muted text-sm px-4 py-6 text-center">No progress events yet</p>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-th-border/30">
              {progressActivity.map(entry => (
                <ActivityFeedItem
                  key={entry.id}
                  entry={entry}
                  projectName={projectName}
                  onClick={() => setSelectedActivity({ entry, projectName })}
                />
              ))}
            </div>
          )}
        </section>
        </SectionErrorBoundary>
      </div>

      {/* ── Token Usage (persisted — works even when session is inactive) ── */}
      {effectiveId && (
        <div className="mt-2">
          <SectionErrorBoundary name="Token usage">
            <TokenUsageSection projectId={effectiveId} />
          </SectionErrorBoundary>
        </div>
      )}

      {/* ── Session History (prominent — multi-session context) ── */}
      {effectiveId && (
        <section className="mt-4" data-testid="session-history-section">
          <h3 className="flex items-center gap-2 text-sm font-medium text-th-text mb-2">
            <History size={14} className="text-th-text-muted" />
            Session History
          </h3>
          <SectionErrorBoundary name="Session history">
            <SessionHistory projectId={effectiveId} hasActiveLead={hasActiveLead} />
          </SectionErrorBoundary>
        </section>
      )}

      </div>

      {/* Decision Detail Modal */}
      {selectedDecision && (
        <DecisionDetailModal
          decision={selectedDecision}
          projectName={projectName}
          onClose={() => setSelectedDecision(null)}
        />
      )}

      {/* Activity Detail Modal */}
      {selectedActivity && (
        <ActivityDetailModal
          entry={selectedActivity.entry}
          projectName={selectedActivity.projectName}
          onClose={() => setSelectedActivity(null)}
        />
      )}

      {/* New Session Dialog */}
      {showNewSessionDialog && effectiveId && (
        <NewSessionDialog
          projectId={effectiveId}
          onClose={() => setShowNewSessionDialog(false)}
          onStarted={() => setShowNewSessionDialog(false)}
        />
      )}
    </div>
  );
}
