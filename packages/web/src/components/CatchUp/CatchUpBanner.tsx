import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { apiFetch } from '../../hooks/useApi';

// ── Types ──────────────────────────────────────────────────────────

export interface CatchUpSummary {
  tasksCompleted: number;
  tasksFailed: number;
  decisionsPending: number;
  decisionsAutoApproved: number;
  commits: number;
  agentsSpawned: number;
  agentsCrashed: number;
  contextCompactions: number;
  budgetWarning: boolean;
  messageCount: number;
}

export interface CatchUpHighlight {
  type: 'task' | 'decision' | 'crash' | 'commit' | 'spawn';
  summary: string;
  timestamp: string;
  agentId?: string;
  linkTo?: string;
}

export interface CatchUpResponse {
  awayDuration: number;
  summary: CatchUpSummary;
  highlights: CatchUpHighlight[];
}

// ── Event categories (priority ordered) ────────────────────────────

interface SummaryCategory {
  key: keyof CatchUpSummary;
  icon: string;
  label: (n: number) => string;
  linkTo: string;
  /** Minimum count to display (default 1, messageCount uses 5) */
  minCount?: number;
}

const CATEGORIES: SummaryCategory[] = [
  { key: 'decisionsPending', icon: '⚠', label: (n) => `${n} decision${n !== 1 ? 's' : ''} pending`, linkTo: '/tasks' },
  { key: 'tasksFailed', icon: '❌', label: (n) => `${n} task${n !== 1 ? 's' : ''} failed`, linkTo: '/tasks?status=failed' },
  { key: 'agentsCrashed', icon: '🔴', label: (n) => `${n} agent${n !== 1 ? 's' : ''} crashed`, linkTo: '/crews' },
  { key: 'tasksCompleted', icon: '✅', label: (n) => `${n} task${n !== 1 ? 's' : ''} completed`, linkTo: '/tasks' },
  { key: 'decisionsAutoApproved', icon: '✓', label: (n) => `${n} auto-approved`, linkTo: '/settings' },
  { key: 'commits', icon: '📦', label: (n) => `${n} commit${n !== 1 ? 's' : ''}`, linkTo: '/timeline' },
  { key: 'agentsSpawned', icon: '🟢', label: (n) => `${n} agent${n !== 1 ? 's' : ''} spawned`, linkTo: '/crews' },
  { key: 'contextCompactions', icon: '🧠', label: (n) => `${n} compaction${n !== 1 ? 's' : ''}`, linkTo: '/mission-control' },
  { key: 'messageCount', icon: '💬', label: (n) => `${n} messages`, linkTo: '/mission-control', minCount: 5 },
];

// ── Severity helpers ───────────────────────────────────────────────

type Severity = 'all-good' | 'normal' | 'attention' | 'critical';

function deriveSeverity(s: CatchUpSummary): Severity {
  if (s.budgetWarning || s.agentsCrashed >= 2 || s.tasksFailed >= 2) return 'critical';
  if (s.decisionsPending > 0 || s.agentsCrashed > 0 || s.tasksFailed > 0) return 'attention';
  const total = s.tasksCompleted + s.commits + s.agentsSpawned +
    s.decisionsAutoApproved + s.contextCompactions + s.messageCount;
  if (total > 0 && s.decisionsPending === 0 && s.agentsCrashed === 0) return 'all-good';
  return 'normal';
}

const SEVERITY_BORDER: Record<Severity, string> = {
  'all-good': 'border-green-500/40',
  normal: 'border-th-border',
  attention: 'border-l-4 border-yellow-500',
  critical: 'border-l-4 border-red-500',
};

const SEVERITY_ICON: Record<Severity, string> = {
  'all-good': '✅',
  normal: '📋',
  attention: '⚠',
  critical: '🔴',
};

// ── Duration formatter ─────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

// ── Narrative generator (template-based, no LLM) ──────────────────

function generateNarrative(s: CatchUpSummary, highlights: CatchUpHighlight[]): string | null {
  const parts: string[] = [];

  if (s.tasksCompleted > 0) {
    const taskHighlight = highlights.find((h) => h.type === 'task');
    parts.push(taskHighlight
      ? `${taskHighlight.summary}`
      : `${s.tasksCompleted} task${s.tasksCompleted !== 1 ? 's' : ''} completed`);
  }

  if ((s.tasksFailed ?? 0) > 0) {
    parts.push(`${s.tasksFailed} task${s.tasksFailed !== 1 ? 's' : ''} failed`);
  }

  if (s.agentsCrashed > 0) {
    const crashHighlight = highlights.find((h) => h.type === 'crash');
    parts.push(crashHighlight ? crashHighlight.summary : `${s.agentsCrashed} agent${s.agentsCrashed !== 1 ? 's' : ''} crashed`);
  }

  if (s.contextCompactions > 0) parts.push(`${s.contextCompactions} context compaction${s.contextCompactions !== 1 ? 's' : ''}`);

  if (s.decisionsPending > 0) {
    parts.push(`${s.decisionsPending} decision${s.decisionsPending !== 1 ? 's' : ''} need${s.decisionsPending === 1 ? 's' : ''} your review`);
  }

  if (parts.length === 0) return null;
  // Join first N parts into a sentence
  return parts.slice(0, 3).join('. ') + '.';
}

// ── localStorage helpers ───────────────────────────────────────────

const LAST_SEEN_KEY = 'flightdeck-last-seen';

function getLastSeen(): string | null {
  try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
}

function setLastSeen(iso: string) {
  try { localStorage.setItem(LAST_SEEN_KEY, iso); } catch { /* noop */ }
}

const AUTO_DISMISS_MS = 20_000;

// ── Component ──────────────────────────────────────────────────────

export function CatchUpBanner() {
  const [data, setData] = useState<CatchUpResponse | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awayStartRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const agents = useAppStore((s) => s.agents);
  const setApprovalQueueOpen = useAppStore((s) => s.setApprovalQueueOpen);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const oversightLevel = useSettingsStore((s) => s.oversightLevel);
  // Derive leadId: prefer selected, then first lead agent
  const leadId = useMemo(() => {
    if (selectedLeadId) return selectedLeadId;
    const lead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
    return lead?.id ?? null;
  }, [selectedLeadId, agents]);

  // On idle: record the away-start timestamp
  const handleIdle = useCallback(() => {
    awayStartRef.current = new Date().toISOString();
  }, []);

  // On return: fetch catch-up data
  const handleReturn = useCallback(async () => {
    const since = awayStartRef.current ?? getLastSeen();
    awayStartRef.current = null;
    if (!since || !leadId) return;

    try {
      const body = await apiFetch<CatchUpResponse>(`/summary/${leadId}/since?t=${encodeURIComponent(since)}`);

      const s = body.summary;

      // AC-15.5: Count total state changes (must be ≥5 to show banner)
      const totalChanges = s.tasksCompleted + (s.tasksFailed ?? 0) + s.decisionsPending +
        s.decisionsAutoApproved + s.commits + s.agentsSpawned + s.agentsCrashed +
        s.contextCompactions + (s.messageCount >= 5 ? s.messageCount : 0) +
        (s.budgetWarning ? 1 : 0);
      if (totalChanges < 5) return;

      // AC-15.6: In Minimal mode, only show for RED-level exceptions (failures/crashes)
      if (oversightLevel === 'autonomous') {
        const hasRedExceptions = (s.tasksFailed ?? 0) > 0 || s.agentsCrashed > 0 || s.budgetWarning;
        if (!hasRedExceptions) return;
      }

      setData(body);
      setDismissed(false);
      setVisible(true);

      // Auto-dismiss after 20s of activity
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
      autoDismissRef.current = setTimeout(() => {
        setVisible(false);
      }, AUTO_DISMISS_MS);
    } catch {
      // API not ready yet — silently skip
    }
  }, [leadId, oversightLevel]);

  useIdleTimer({ onIdle: handleIdle, onReturn: handleReturn });

  // Update lastSeen on visibility change
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'hidden') {
        setLastSeen(new Date().toISOString());
      }
    };
    document.addEventListener('visibilitychange', update);
    // Set initial lastSeen
    setLastSeen(new Date().toISOString());
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Escape key dismisses
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVisible(false);
        setDismissed(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible]);

  // Cleanup auto-dismiss timer
  useEffect(() => {
    return () => {
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setDismissed(true);
    if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
  }, []);

  // Derived state
  const severity = useMemo(() => data ? deriveSeverity(data.summary) : 'normal', [data]);
  const narrative = useMemo(
    () => data ? generateNarrative(data.summary, data.highlights) : null,
    [data],
  );
  const activeCategories = useMemo(() => {
    if (!data) return [];
    return CATEGORIES.filter((cat) => {
      if (cat.key === 'budgetWarning') return false; // handled separately
      const val = data.summary[cat.key];
      if (typeof val === 'boolean') return val;
      return (val as number) >= (cat.minCount ?? 1);
    });
  }, [data]);

  if (!visible || dismissed || !data) return null;

  const isCompact = severity === 'all-good';
  const borderClass = SEVERITY_BORDER[severity];
  const icon = SEVERITY_ICON[severity];

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-xl mx-auto animate-slide-up`}
      role="status"
      aria-live="polite"
      data-testid="catchup-banner"
    >
      <div className={`bg-th-bg-alt/95 backdrop-blur-md border rounded-xl shadow-2xl ${borderClass}`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-medium text-th-text-alt flex-1">
            While you were away ({formatDuration(data.awayDuration)}):
          </span>
          <button
            onClick={dismiss}
            className="p-1 rounded hover:bg-th-bg-hover transition-colors text-th-text-muted hover:text-th-text"
            aria-label="Dismiss catch-up banner"
            data-testid="catchup-dismiss"
          >
            <X size={14} />
          </button>
        </div>

        {/* Narrative (when 3+ events) */}
        {narrative && (
          <p className="px-4 text-[11px] text-th-text-muted leading-relaxed pb-1">
            {narrative}
          </p>
        )}

        {/* Summary grid (non-compact mode) */}
        {!isCompact && activeCategories.length > 0 && (
          <div className="px-4 py-2 flex flex-wrap gap-x-4 gap-y-1">
            {activeCategories.map((cat) => {
              const val = data.summary[cat.key] as number;
              return (
                <button
                  key={cat.key}
                  onClick={() => {
                    if (cat.key === 'decisionsPending') {
                      setApprovalQueueOpen(true);
                    } else {
                      navigate(cat.linkTo);
                    }
                    dismiss();
                  }}
                  className="flex items-center gap-1.5 text-xs text-th-text-muted hover:text-th-text-alt transition-colors"
                  data-testid={`catchup-item-${cat.key}`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label(val)}</span>
                </button>
              );
            })}
            {data.summary.budgetWarning && (
              <button
                onClick={() => { navigate('/settings'); dismiss(); }}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                data-testid="catchup-item-budget"
              >
                <span>💰</span>
                <span>Budget warning</span>
              </button>
            )}
          </div>
        )}

        {/* Compact all-good message */}
        {isCompact && (
          <p className="px-4 pb-2 text-xs text-th-text-muted">
            Everything is on track.
          </p>
        )}

        {/* Action bar (non-compact) */}
        {!isCompact && (
          <div className="flex items-center gap-2 px-4 pb-3 pt-1 border-t border-th-border/40">
            {data.summary.decisionsPending > 0 && (
              <button
                onClick={() => { setApprovalQueueOpen(true); dismiss(); }}
                className="px-3 py-1 text-[11px] font-medium bg-yellow-500/20 text-yellow-400 rounded-md hover:bg-yellow-500/30 transition-colors"
                data-testid="catchup-action-approval"
              >
                Open Approval Queue ⚠
              </button>
            )}
            {(data.summary.tasksFailed ?? 0) > 0 && (
              <button
                onClick={() => { navigate('/tasks?status=failed'); dismiss(); }}
                className="px-3 py-1 text-[11px] font-medium bg-red-500/20 text-red-400 rounded-md hover:bg-red-500/30 transition-colors"
                data-testid="catchup-action-failed"
              >
                View failed tasks ❌
              </button>
            )}
            <button
              onClick={() => { navigate('/timeline'); dismiss(); }}
              className="px-3 py-1 text-[11px] font-medium bg-th-bg/50 text-th-text-muted rounded-md border border-th-border/50 hover:text-th-text-alt hover:border-th-border transition-colors"
              data-testid="catchup-action-replay"
            >
              Review in Replay ◷
            </button>
            <div className="flex-1" />
            <button
              onClick={dismiss}
              className="px-3 py-1 text-[11px] text-th-text-muted hover:text-th-text transition-colors"
              data-testid="catchup-action-dismiss"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
