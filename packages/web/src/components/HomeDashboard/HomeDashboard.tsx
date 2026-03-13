/**
 * HomeDashboard — Command center for Flightdeck.
 *
 * Sections (in visual priority order):
 * 1. User Action Required — decisions needing approval + permission requests
 * 2. Active Work — what agents are doing right now, grouped by project
 * 3. Decisions Made — feed of recent agent decisions (informational)
 * 4. Recent Activity — feed of task completions, agent spawns, key events
 * 5. Progress — per-project DAG task summaries
 * 6. Projects — card grid of all active projects
 *
 * Supports many-to-many Teams ↔ Projects relationship by design.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  Clock,
  Activity,
  Zap,
  Bell,
  Plus,
  ChevronRight,
  ChevronDown,
  Gavel,
  ListChecks,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge, projectStatusProps } from '../ui/StatusBadge';
import { useAttentionItems } from '../AttentionBar';
import {
  DecisionFeedItem,
  DecisionDetailModal,
  ActivityFeedItem,
  ActivityDetailModal,
} from '../Shared';
import type { ActivityEntry } from '../Shared';
import type { AgentInfo, Decision, DagStatus } from '../../types';

// ── Types ───────────────────────────────────────────────────────────

/** Enriched project data from GET /api/projects */
interface EnrichedProject {
  id: string;
  name: string;
  description: string;
  cwd: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  activeAgentCount: number;
  storageMode: 'user' | 'local';
  sessions?: Array<{
    id: number;
    projectId: string;
    leadId: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    task: string | null;
  }>;
  activeLeadId?: string;
}

/** Per-project DAG progress summary */
interface ProjectProgress {
  projectId: string;
  projectName: string;
  leadId: string;
  summary: DagStatus['summary'];
}


// ── Helpers ─────────────────────────────────────────────────────────

function getProjectStatusVariant(
  agentCount: number,
  failedCount: number,
  status: string,
): { variant: 'success' | 'warning' | 'error' | 'neutral'; label: string; pulse: boolean } {
  if (status === 'archived') return { variant: 'neutral', label: 'Archived', pulse: false };
  if (agentCount > 0) {
    return { variant: 'success', label: `${agentCount} agent${agentCount > 1 ? 's' : ''} running`, pulse: true };
  }
  if (failedCount > 0) return { variant: 'error', label: `${failedCount} failed`, pulse: false };
  return { variant: 'neutral', label: 'Stopped', pulse: false };
}

function resolveProjectName(
  projectId: string | null | undefined,
  projects: EnrichedProject[],
  agents: AgentInfo[],
): string {
  if (!projectId) return 'Unknown';
  const project = projects.find(p => p.id === projectId);
  if (project) return project.name;
  const lead = agents.find(a => a.projectId === projectId && a.role?.id === 'lead');
  if (lead?.projectName) return lead.projectName;
  return projectId.slice(0, 12);
}


// ── Sub-Components ──────────────────────────────────────────────────

function ActionRequiredItem({
  icon,
  title,
  subtitle,
  timestamp,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  timestamp: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-th-bg-alt/30 transition-colors group"
      data-testid="action-required-item"
    >
      <span className="shrink-0 text-amber-400">{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-th-text-alt truncate block">{title}</span>
        <span className="text-[10px] text-th-text-muted">{subtitle}</span>
      </div>
      <span className="text-[10px] text-th-text-muted shrink-0">{formatRelativeTime(timestamp)}</span>
      <ChevronRight className="w-3.5 h-3.5 text-th-text-muted/50 shrink-0 group-hover:text-th-text-muted" />
    </button>
  );
}

function ActiveAgentRow({ agent, projectName }: { agent: AgentInfo; projectName: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2" data-testid="active-agent-row">
      <span className="relative flex shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping bg-green-400" />
        <span className="relative inline-flex rounded-full w-2 h-2 bg-green-400" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-th-text-alt">{agent.role?.name ?? agent.role?.id ?? 'Agent'}</span>
          <span className="text-[10px] text-th-text-muted">{projectName}</span>
        </div>
        {agent.task && (
          <p className="text-[10px] text-th-text-muted truncate mt-0.5">{agent.task}</p>
        )}
      </div>
      <StatusBadge
        variant={agent.status === 'running' ? 'success' : agent.status === 'creating' ? 'warning' : 'info'}
        label={agent.status}
        size="sm"
      />
    </div>
  );
}


function ProgressBar({ summary }: { summary: DagStatus['summary'] }) {
  const total = summary.done + summary.running + summary.ready + summary.pending + summary.failed + summary.blocked + summary.paused + summary.skipped;
  if (total === 0) return null;
  const pct = Math.round((summary.done / total) * 100);

  return (
    <div className="space-y-1.5" data-testid="progress-bar">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-th-text-muted">
          {summary.done}/{total} tasks · {summary.running} running{summary.failed > 0 && <> · <span className="text-red-400">{summary.failed} failed</span></>}
        </span>
        <span className="font-medium text-th-text-alt">{pct}%</span>
      </div>
      <div className="h-1.5 bg-th-bg-muted rounded-full overflow-hidden flex">
        {summary.done > 0 && (
          <div className="bg-green-400 transition-all" style={{ width: `${(summary.done / total) * 100}%` }} />
        )}
        {summary.running > 0 && (
          <div className="bg-blue-400 transition-all" style={{ width: `${(summary.running / total) * 100}%` }} />
        )}
        {summary.failed > 0 && (
          <div className="bg-red-400 transition-all" style={{ width: `${(summary.failed / total) * 100}%` }} />
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  agentCount,
  failedCount,
  onClick,
}: {
  project: EnrichedProject;
  agentCount: number;
  failedCount?: number;
  onClick: () => void;
}) {
  const status = getProjectStatusVariant(agentCount, failedCount ?? 0, project.status);
  const activeSessions = project.sessions?.filter(s => s.status === 'active') ?? [];

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-surface-raised border border-th-border rounded-lg p-4 transition-colors hover:border-th-border-hover hover:bg-th-bg-alt/20 group"
      data-testid="project-card"
    >
      <div className="flex items-start gap-3">
        <FolderOpen className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-th-text-alt">{project.name}</span>
            <StatusBadge variant={status.variant} label={status.label} dot pulse={status.pulse} />
          </div>
          {project.description && (
            <p className="text-xs text-th-text-muted line-clamp-2 mt-1">{project.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-th-text-muted">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(project.updatedAt)}
            </span>
            {agentCount > 0 && (
              <span className="flex items-center gap-1 text-accent">
                <Users className="w-3 h-3" />
                {agentCount}
              </span>
            )}
            {activeSessions.length > 0 && (
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {activeSessions.length} session{activeSessions.length > 1 ? 's' : ''}
              </span>
            )}
            {(failedCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertTriangle className="w-3 h-3" />
                {failedCount} failed
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-th-text-muted/50 shrink-0 group-hover:text-th-text-muted transition-colors mt-1" />
      </div>
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function HomeDashboard() {
  const navigate = useNavigate();
  const agents = useAppStore((s) => s.agents);
  const pendingDecisions = useAppStore((s) => s.pendingDecisions);
  const attention = useAttentionItems();

  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [allDecisions, setAllDecisions] = useState<Decision[]>([]);
  const [progressByProject, setProgressByProject] = useState<ProjectProgress[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<{ decision: Decision; projectName: string } | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<{ entry: ActivityEntry; projectName: string } | null>(null);

  // Fetch projects + decisions + progress + activity
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const [projectsData, decisionsData, activityData] = await Promise.all([
        apiFetch<EnrichedProject[]>('/projects').catch(() => []),
        apiFetch<Decision[]>('/decisions').catch(() => []),
        apiFetch<ActivityEntry[]>('/coordination/activity?type=progress_update&limit=15').catch(() => []),
      ]);

      const activeProjects = Array.isArray(projectsData)
        ? projectsData.filter(p => p.status !== 'archived')
        : [];
      setProjects(activeProjects);
      setAllDecisions(Array.isArray(decisionsData) ? decisionsData : []);

      // Server already filters to progress_update; keep lead-only filter client-side
      const progressActivity = (Array.isArray(activityData) ? activityData : [])
        .filter((a) => a.agentRole === 'lead')
        .slice(0, 15);
      setRecentActivity(progressActivity);

      // Fetch DAG progress for projects with active leads (parallelized)
      const dagPromises = activeProjects
        .map((proj) => {
          const leadId = proj.activeLeadId || proj.sessions?.find(s => s.status === 'active')?.leadId;
          if (!leadId) return null;
          return apiFetch<DagStatus>(`/lead/${leadId}/dag`)
            .then((dag): ProjectProgress | null => {
              if (!dag?.summary) return null;
              const total = Object.values(dag.summary).reduce((a, b) => a + b, 0);
              if (total === 0) return null;
              return { projectId: proj.id, projectName: proj.name, leadId, summary: dag.summary };
            })
            .catch((err) => { console.warn('[HomeDashboard] DAG fetch failed for project:', err); return null; });
        })
        .filter(Boolean);
      const progressResults = (await Promise.all(dagPromises)).filter(
        (r): r is ProjectProgress => r !== null,
      );
      setProgressByProject(progressResults);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Derived data ─────────────────────────────────────────────

  // Live agent counts from WebSocket
  const agentCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      if (agent.projectId && agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'terminated') {
        counts.set(agent.projectId, (counts.get(agent.projectId) ?? 0) + 1);
      }
    }
    return counts;
  }, [agents]);

  // Active (non-terminal) agents for the "Active Work" section
  const activeAgents = useMemo(() => {
    return agents.filter(a =>
      a.status === 'running' || a.status === 'creating' || a.status === 'idle',
    );
  }, [agents]);

  // Decisions needing user approval
  const decisionsNeedingApproval = useMemo(() => {
    return pendingDecisions
      .filter((d: Decision) => d.needsConfirmation && d.status === 'recorded')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [pendingDecisions]);

  // Total action-required count
  const actionRequiredCount = decisionsNeedingApproval.length;

  // Recent decisions (informational feed — all statuses, last 10)
  const recentDecisions = useMemo(() => {
    return [...allDecisions]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
  }, [allDecisions]);

  // Sort projects: active agents first, then by updatedAt
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aAgents = agentCountByProject.get(a.id) ?? a.activeAgentCount;
      const bAgents = agentCountByProject.get(b.id) ?? b.activeAgentCount;
      if (aAgents > 0 && bAgents === 0) return -1;
      if (bAgents > 0 && aAgents === 0) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [projects, agentCountByProject]);

  const totalRunningAgents = useMemo(() => {
    return agents.filter(a => a.status !== 'completed' && a.status !== 'failed' && a.status !== 'terminated').length;
  }, [agents]);

  const avgProgress = useMemo(() => {
    if (progressByProject.length === 0) return 0;
    const totals = progressByProject.reduce((acc, p) => {
      const total = Object.values(p.summary).reduce((a, b) => a + b, 0);
      return { done: acc.done + p.summary.done, total: acc.total + total };
    }, { done: 0, total: 0 });
    return totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
  }, [progressByProject]);

  const failedByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of progressByProject) {
      if (p.summary.failed > 0) map.set(p.projectId, p.summary.failed);
    }
    return map;
  }, [progressByProject]);

  // Group active agents by project for grouped display
  const agentsByProject = useMemo(() => {
    const map = new Map<string, AgentInfo[]>();
    for (const agent of activeAgents) {
      const key = agent.projectId ?? '__unknown__';
      const group = map.get(key);
      if (group) {
        group.push(agent);
      } else {
        map.set(key, [agent]);
      }
    }
    return map;
  }, [activeAgents]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Navigation ───────────────────────────────────────────────

  const handleNavigateToProject = useCallback(
    (projectId: string) => navigate(`/projects/${projectId}/session`),
    [navigate],
  );

  const handleNavigateToProjects = useCallback(
    () => navigate('/projects'),
    [navigate],
  );

  // ── Loading ──────────────────────────────────────────────────
  if (loading && projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="home-loading">
        <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────
  if (!loading && fetchError) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="home-error">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-th-text mb-1">Failed to load projects</h3>
          <p className="text-xs text-th-text-muted mb-4">{fetchError}</p>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/80 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!loading && projects.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6 focus:outline-none" tabIndex={0} data-testid="home-empty">
        <EmptyState
          icon={<Zap className="w-12 h-12" />}
          title="Welcome to Flightdeck!"
          description="Start your first AI crew. Each project gets its own crew, knowledge base, and task board."
          action={{ label: 'Create Project', onClick: handleNavigateToProjects }}
        >
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg text-left text-xs text-th-text-muted">
            <div className="flex items-start gap-2 rounded-md border border-th-border p-2.5">
              <FolderOpen size={14} className="mt-0.5 shrink-0 text-th-accent" />
              <span><strong className="text-th-text">Projects</strong> — organize work by goal or repo</span>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-th-border p-2.5">
              <Users size={14} className="mt-0.5 shrink-0 text-th-accent" />
              <span><strong className="text-th-text">Crews</strong> — assign roles like architect, developer, reviewer</span>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-th-border p-2.5">
              <ListChecks size={14} className="mt-0.5 shrink-0 text-th-accent" />
              <span><strong className="text-th-text">Tasks</strong> — agents break work into a DAG and execute</span>
            </div>
          </div>
        </EmptyState>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto focus:outline-none" tabIndex={0}>
    <div className="p-6 max-w-6xl mx-auto" data-testid="home-dashboard">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="w-6 h-6 text-th-text-muted" />
        <h1 className="text-xl font-semibold text-th-text-alt">Home</h1>
      </div>

      {/* Compact Stat Strip — ambient context, lowest visual weight */}
      <div className="flex items-center gap-2 text-sm text-th-text-muted/70 mb-6 px-1" data-testid="home-stats">
        <span>📁 {projects.length} project{projects.length !== 1 ? 's' : ''}</span>
        <span className="text-th-text-muted/30">·</span>
        <span>🤖 {totalRunningAgents} agent{totalRunningAgents !== 1 ? 's' : ''} running</span>
        <span className="text-th-text-muted/30">·</span>
        <span>📊 {avgProgress}% progress</span>
        {attention.failedTaskCount > 0 && (
          <>
            <span className="text-th-text-muted/30">·</span>
            <span className="text-red-400">⚠ {attention.failedTaskCount} failed</span>
          </>
        )}
      </div>

      {/* ── Section 1: User Action Required ──────────────────── */}
      {actionRequiredCount > 0 && (
        <div className="mb-6" data-testid="action-required-section">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-medium text-th-text-alt">User Action Required</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 font-medium">
              {actionRequiredCount}
            </span>
          </div>
          <div className="bg-surface-raised border border-amber-400/20 rounded-lg divide-y divide-th-border">
            {/* Decisions needing approval */}
            {decisionsNeedingApproval.slice(0, 5).map((d) => (
              <ActionRequiredItem
                key={`dec-${d.id}`}
                icon={<Gavel className="w-4 h-4" />}
                title={d.title}
                subtitle={`${resolveProjectName(d.projectId, projects, agents)} · ${d.agentRole} · ${d.category}`}
                timestamp={d.timestamp}
                onClick={() => { if (d.projectId) handleNavigateToProject(d.projectId); }}
              />
            ))}
            {decisionsNeedingApproval.length > 5 && (
              <div className="px-3 py-2 text-[11px] text-th-text-muted text-center">
                +{decisionsNeedingApproval.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section 2: Active Work ───────────────────────────── */}
      {activeAgents.length > 0 && (
        <div className="mb-6" data-testid="active-work-section">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
            <h2 className="text-sm font-medium text-th-text-alt">Active Work</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400 font-medium">
              {activeAgents.length} agent{activeAgents.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2">
            {Array.from(agentsByProject.entries()).map(([projectId, groupAgents]) => {
              const projectName = resolveProjectName(projectId === '__unknown__' ? null : projectId, projects, agents);
              const isCollapsed = collapsedGroups.has(projectId);
              return (
                <div
                  key={projectId}
                  className="bg-surface-raised border border-th-border rounded-lg"
                  data-testid="active-work-group"
                >
                  <button
                    type="button"
                    onClick={() => setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(projectId)) next.delete(projectId);
                      else next.add(projectId);
                      return next;
                    })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-th-bg-alt/20 transition-colors rounded-t-lg"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 text-th-text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span className="text-xs font-medium text-th-text-alt">📁 {projectName}</span>
                    <span className="text-[10px] text-th-text-muted">
                      ({groupAgents.length} agent{groupAgents.length > 1 ? 's' : ''})
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-th-border border-t border-th-border">
                      {groupAgents.map((agent) => (
                        <ActiveAgentRow
                          key={agent.id}
                          agent={agent}
                          projectName=""
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Two-column: Decisions + Progress ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Section 3: Decisions Made */}
        {recentDecisions.length > 0 && (
          <div data-testid="decisions-feed-section">
            <div className="flex items-center gap-2 mb-3">
              <Gavel className="w-4 h-4 text-th-text-muted" />
              <h2 className="text-sm font-medium text-th-text-alt">Recent Decisions</h2>
            </div>
            <div className="bg-surface-raised border border-th-border rounded-lg divide-y divide-th-border max-h-64 overflow-y-auto">
              {recentDecisions.map((d) => {
                const pName = resolveProjectName(d.projectId, projects, agents);
                return (
                  <DecisionFeedItem
                    key={d.id}
                    decision={d}
                    projectName={pName}
                    onClick={() => setSelectedDecision({ decision: d, projectName: pName })}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Section 4: Recent Progress */}
        <div data-testid="activity-feed-section">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-th-text-muted" />
            <h2 className="text-sm font-medium text-th-text-alt">Recent Progress</h2>
          </div>
          {recentActivity.length > 0 ? (
            <div className="bg-surface-raised border border-th-border rounded-lg divide-y divide-th-border max-h-64 overflow-y-auto">
              {recentActivity.map((a) => {
                const pName = resolveProjectName(a.projectId, projects, agents);
                return (
                  <ActivityFeedItem
                    key={a.id}
                    entry={a}
                    projectName={pName}
                    onClick={() => setSelectedActivity({ entry: a, projectName: pName })}
                  />
                );
              })}
            </div>
          ) : (
            <div className="bg-surface-raised border border-th-border rounded-lg px-3 py-4 text-center text-xs text-th-text-muted">
              No progress updates yet. Updates appear here when the lead reports progress.
            </div>
          )}
        </div>

        {/* Section 5: Progress */}
        {progressByProject.length > 0 && (
          <div data-testid="progress-section">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="w-4 h-4 text-th-text-muted" />
              <h2 className="text-sm font-medium text-th-text-alt">Progress</h2>
            </div>
            <div className="space-y-3">
              {progressByProject.map((p) => (
                <button
                  key={p.projectId}
                  type="button"
                  onClick={() => handleNavigateToProject(p.projectId)}
                  className="w-full text-left bg-surface-raised border border-th-border rounded-lg p-3 hover:border-th-border-hover transition-colors"
                  data-testid="progress-card"
                >
                  <div className="text-xs font-medium text-th-text-alt mb-2">{p.projectName}</div>
                  <ProgressBar summary={p.summary} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 5: Projects Grid ─────────────────────────── */}
      <div data-testid="home-projects">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-th-text-muted" />
            <h2 className="text-sm font-medium text-th-text-alt">Projects</h2>
          </div>
          <button
            type="button"
            onClick={handleNavigateToProjects}
            className="flex items-center gap-1 text-xs text-th-text-muted hover:text-accent transition-colors"
          >
            <Plus className="w-3 h-3" />
            Manage Projects
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sortedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              agentCount={agentCountByProject.get(project.id) ?? project.activeAgentCount}
              failedCount={failedByProject.get(project.id)}
              onClick={() => handleNavigateToProject(project.id)}
            />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/projects?action=new')}
          className="flex items-center gap-1.5 px-4 py-2 text-xs text-th-text-muted hover:text-th-text rounded-lg hover:bg-th-bg-muted transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          Start New Session
        </button>
      </div>

      {/* Detail Modals */}
      {selectedDecision && (
        <DecisionDetailModal
          decision={selectedDecision.decision}
          projectName={selectedDecision.projectName}
          onClose={() => setSelectedDecision(null)}
        />
      )}
      {selectedActivity && (
        <ActivityDetailModal
          entry={selectedActivity.entry}
          projectName={selectedActivity.projectName}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </div>
    </div>
  );
}
