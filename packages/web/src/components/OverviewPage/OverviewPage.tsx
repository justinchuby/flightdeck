/**
 * OverviewPage — Project Command Center.
 *
 * Answers: "What needs my attention right now?"
 * - Quick Status Bar — running/stopped, agent count, task progress, duration
 * - Session Controls — start/stop/resume
 * - Attention Items — alerts from detectAlerts (failed agents, pending decisions, blocked tasks)
 * - Two-column feed: Decisions + Progress (including milestones)
 * - Session History (collapsible, always visible)
 *
 * All visualization charts moved to AnalysisPage.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { useProjects } from '../../hooks/useProjects';
import { useEffectiveProjectId } from '../../hooks/useEffectiveProjectId';
import { formatDateTime } from '../../utils/format';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { POLL_INTERVAL_MS } from '../../constants/timing';
import { SessionHistory, NewSessionDialog } from '../SessionHistory';
import { detectAlerts, type AlertSeverity } from '../MissionControl/AlertsPanel';
import {
  DecisionFeedItem,
  DecisionDetailModal,
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
} from 'lucide-react';
import type { Decision, DagStatus } from '../../types';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';

// ── Constants ──────────────────────────────────────────────────────

const SEVERITY_BG: Record<AlertSeverity, string> = {
  critical: 'bg-red-500/10 border border-red-500/20',
  warning: 'bg-amber-500/10 border border-amber-500/20',
  info: 'bg-blue-500/10 border border-blue-500/20',
};

const DECISIONS_FEED_LIMIT = 6;
const PROGRESS_FEED_LIMIT = 8;
const EMPTY_DECISIONS: Decision[] = [];
interface ProgressItem {
  id: string;
  icon: string;
  text: string;
  detail: string;
  timestamp: number;
}

// ── Props ──────────────────────────────────────────────────────────

interface Props {
  api?: any;
  ws?: any;
}

// ── Component ──────────────────────────────────────────────────────

export function OverviewPage(_props: Props) {
  const agents = useAppStore((s) => s.agents);
  const { projects } = useProjects();
  const effectiveId = useEffectiveProjectId();

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
  const [historyOpen, setHistoryOpen] = useState(!hasActiveLead);

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

  // Auto-expand history when session stops, collapse when it starts
  useEffect(() => { setHistoryOpen(!hasActiveLead); }, [hasActiveLead]);

  const handleStopSession = useCallback(async () => {
    if (!effectiveId) return;
    setStopping(true);
    try {
      await apiFetch(`/projects/${effectiveId}/stop`, { method: 'POST' });
    } catch { /* ignore */ }
    finally { setStopping(false); }
  }, [effectiveId]);

  // ── Attention alerts ──────────────────────────────────────────
  const dagStatus = useLeadStore(s => {
    const proj = s.projects[effectiveId ?? ''];
    return proj?.dagStatus ?? null;
  });
  const storeDecisions = useLeadStore(s => {
    const proj = s.projects[effectiveId ?? ''];
    return proj?.decisions ?? EMPTY_DECISIONS;
  });

  const alerts = useMemo(
    () => detectAlerts(projectAgents, storeDecisions, dagStatus),
    [projectAgents, storeDecisions, dagStatus],
  );

  // ── Decisions feed ────────────────────────────────────────────
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!effectiveId) return;
    mountedRef.current = true;
    const poll = async () => {
      try {
        const data = await apiFetch<Decision[]>(`/lead/${effectiveId}/decisions`);
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

  // ── Progress feed (activity + milestone keyframes) ────────────
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [milestoneKeyframes, setMilestoneKeyframes] = useState<ReplayKeyframe[]>([]);

  useEffect(() => {
    if (!effectiveId) return;
    const poll = async () => {
      try {
        const data = await apiFetch<ActivityEntry[]>(
          `/coordination/activity?projectId=${effectiveId}&type=progress&limit=20`,
        );
        if (mountedRef.current) setActivity(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [effectiveId]);

  // Lightweight keyframes fetch — only milestone/progress types for the feed
  useEffect(() => {
    if (!effectiveId) return;
    const fetchMilestones = async () => {
      try {
        const data = await apiFetch<{ keyframes: ReplayKeyframe[] }>(`/replay/${effectiveId}/keyframes`);
        const kf = (data.keyframes ?? []).filter(
          (k: ReplayKeyframe) => k.type === 'milestone' || k.type === 'progress',
        );
        if (mountedRef.current) setMilestoneKeyframes(kf);
      } catch { /* ignore */ }
    };
    fetchMilestones();
    const interval = setInterval(fetchMilestones, POLL_INTERVAL_MS * 3);
    return () => clearInterval(interval);
  }, [effectiveId]);

  // Merge activity + milestones into unified progress feed
  const progressItems = useMemo((): ProgressItem[] => {
    const items: ProgressItem[] = [];

    for (const entry of activity) {
      items.push({
        id: `activity-${entry.id}`,
        icon: '📊',
        text: entry.summary,
        detail: `${entry.agentRole} · ${formatRelativeTime(entry.timestamp)}`,
        timestamp: new Date(entry.timestamp).getTime(),
      });
    }

    for (const kf of milestoneKeyframes) {
      items.push({
        id: `milestone-${kf.timestamp}`,
        icon: kf.type === 'milestone' ? '🏁' : '📊',
        text: kf.label || `${kf.type} reached`,
        detail: formatRelativeTime(kf.timestamp),
        timestamp: new Date(kf.timestamp).getTime(),
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  }, [activity, milestoneKeyframes]);

  // ── Quick status bar data ─────────────────────────────────────
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
        <span className={hasActiveLead ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
          {hasActiveLead ? '● Running' : '● Stopped'}
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

      {/* ── Session Controls ───────────────────────────────────── */}
      {effectiveId && hasActiveLead && activeLeadAgent && (
        <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="active-session-banner">
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
              onClick={handleStopSession}
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
            <div className="divide-y divide-th-border/30">
              {(actionableDecisions.length > 0 ? actionableDecisions : decisions).slice(0, DECISIONS_FEED_LIMIT).map(d => (
                <DecisionFeedItem
                  key={d.id}
                  decision={d}
                  projectName={projectName}
                  onClick={() => setSelectedDecision(d)}
                />
              ))}
              {(actionableDecisions.length > DECISIONS_FEED_LIMIT || decisions.length > DECISIONS_FEED_LIMIT) && (
                <div className="px-4 py-2 text-center">
                  <span className="text-[10px] text-th-text-muted">
                    +{Math.max(actionableDecisions.length, decisions.length) - DECISIONS_FEED_LIMIT} more
                  </span>
                </div>
              )}
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
          {progressItems.length === 0 ? (
            <p className="text-th-text-muted text-sm px-4 py-6 text-center">No progress events yet</p>
          ) : (
            <div className="divide-y divide-th-border/30">
              {progressItems.slice(0, PROGRESS_FEED_LIMIT).map(item => (
                <div key={item.id} className="flex items-start gap-2.5 px-3 py-2">
                  <span className="text-sm shrink-0 mt-0.5">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-th-text-alt truncate block">{item.text}</span>
                    <div className="text-[10px] text-th-text-muted mt-0.5">{item.detail}</div>
                  </div>
                </div>
              ))}
              {progressItems.length > PROGRESS_FEED_LIMIT && (
                <div className="px-4 py-2 text-center">
                  <span className="text-[10px] text-th-text-muted">+{progressItems.length - PROGRESS_FEED_LIMIT} more</span>
                </div>
              )}
            </div>
          )}
        </section>
        </SectionErrorBoundary>
      </div>

      {/* ── Session History (collapsible, always visible) ──────── */}
      {effectiveId && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(o => !o)}
            className="text-sm text-th-text-muted cursor-pointer hover:text-th-text select-none flex items-center gap-1"
          >
            <span className={`transition-transform ${historyOpen ? 'rotate-90' : ''}`}>▸</span>
            Session History
          </button>
          {historyOpen && (
            <SectionErrorBoundary name="Session history">
            <div className="mt-2">
              <SessionHistory projectId={effectiveId} hasActiveLead={hasActiveLead} />
            </div>
            </SectionErrorBoundary>
          )}
        </div>
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
