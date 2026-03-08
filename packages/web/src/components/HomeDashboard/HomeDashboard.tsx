/**
 * HomeDashboard — Main landing page for Flightdeck.
 *
 * Shows: running projects grid, attention queue (pending decisions),
 * system health overview, and quick stats. Replaces the old HomeRedirect
 * that simply redirected to the active project's session.
 *
 * Supports the many-to-many Teams ↔ Projects relationship by design:
 * project cards show team assignments when available.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  AlertCircle,
  Play,
  Clock,
  Activity,
  Zap,
  Bell,
  Plus,
  Wifi,
  WifiOff,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';
import type { AgentInfo, Decision } from '../../types';

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

/** Attention item — a pending decision or permission request that needs user action */
interface AttentionItem {
  id: string;
  projectId: string | null;
  projectName: string;
  agentRole: string;
  title: string;
  category: string;
  timestamp: string;
  type: 'decision' | 'permission';
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

function getProjectStatusVariant(
  project: EnrichedProject,
): { variant: 'success' | 'warning' | 'neutral'; label: string; pulse: boolean } {
  if (project.activeAgentCount > 0) {
    return { variant: 'success', label: `${project.activeAgentCount} agent${project.activeAgentCount > 1 ? 's' : ''} running`, pulse: true };
  }
  if (project.status === 'active') {
    return { variant: 'warning', label: 'Idle', pulse: false };
  }
  return { variant: 'neutral', label: project.status, pulse: false };
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

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-th-text-muted">{icon}</span>
        <span className="text-xs text-th-text-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-semibold ${accent ? 'text-accent' : 'text-th-text-alt'}`}>
        {value}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  agentCount,
  onClick,
}: {
  project: EnrichedProject;
  agentCount: number;
  onClick: () => void;
}) {
  const status = getProjectStatusVariant({ ...project, activeAgentCount: agentCount });
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
            <StatusBadge
              variant={status.variant}
              label={status.label}
              dot
              pulse={status.pulse}
            />
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
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-th-text-muted/50 shrink-0 group-hover:text-th-text-muted transition-colors mt-1" />
      </div>
    </button>
  );
}

function AttentionQueueItem({
  item,
  onClick,
}: {
  item: AttentionItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-th-bg-alt/30 transition-colors group"
      data-testid="attention-item"
    >
      <span className="relative flex shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping bg-amber-400" />
        <span className="relative inline-flex rounded-full w-2 h-2 bg-amber-400" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-th-text-alt truncate">{item.title}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-th-text-muted mt-0.5">
          <span>{item.projectName}</span>
          <span>·</span>
          <span>{item.agentRole}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.timestamp)}</span>
        </div>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-th-text-muted/50 shrink-0 group-hover:text-th-text-muted" />
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function HomeDashboard() {
  const navigate = useNavigate();
  const agents = useAppStore((s) => s.agents);
  const connected = useAppStore((s) => s.connected);
  const pendingDecisions = useAppStore((s) => s.pendingDecisions);

  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<EnrichedProject[]>('/projects');
      if (Array.isArray(data)) {
        setProjects(data.filter(p => p.status !== 'archived'));
      }
    } catch {
      // Silently fail — empty state is shown
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Count agents per project from live WebSocket data
  const agentCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      if (agent.projectId && agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'terminated') {
        counts.set(agent.projectId, (counts.get(agent.projectId) ?? 0) + 1);
      }
    }
    return counts;
  }, [agents]);

  // Build attention queue from pending decisions
  const attentionItems: AttentionItem[] = useMemo(() => {
    return pendingDecisions
      .filter((d: Decision) => d.needsConfirmation && d.status === 'recorded')
      .map((d: Decision) => ({
        id: d.id,
        projectId: d.projectId,
        projectName: resolveProjectName(d.projectId, projects, agents),
        agentRole: d.agentRole,
        title: d.title,
        category: d.category,
        timestamp: d.timestamp,
        type: 'decision' as const,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [pendingDecisions, projects, agents]);

  // Sort projects: active with agents first, then active idle, then by updatedAt
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aAgents = agentCountByProject.get(a.id) ?? a.activeAgentCount;
      const bAgents = agentCountByProject.get(b.id) ?? b.activeAgentCount;
      // Active with agents first
      if (aAgents > 0 && bAgents === 0) return -1;
      if (bAgents > 0 && aAgents === 0) return 1;
      // Then by most recently updated
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [projects, agentCountByProject]);

  // Derived stats
  const totalRunningAgents = useMemo(() => {
    return agents.filter(a => a.status !== 'completed' && a.status !== 'failed' && a.status !== 'terminated').length;
  }, [agents]);

  const handleNavigateToProject = useCallback(
    (projectId: string) => {
      navigate(`/projects/${projectId}/session`);
    },
    [navigate],
  );

  const handleNavigateToProjects = useCallback(() => {
    navigate('/projects');
  }, [navigate]);

  // ── Loading state ────────────────────────────────────────────
  if (loading && projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="home-loading">
        <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Empty state (no projects) ────────────────────────────────
  if (!loading && projects.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6" data-testid="home-empty">
        <EmptyState
          icon={<LayoutDashboard className="w-12 h-12" />}
          title="Welcome to Flightdeck"
          description="Create your first project to start delegating work to AI agents. Each project gets its own team, knowledge base, and task board."
          action={{
            label: 'View Projects',
            onClick: handleNavigateToProjects,
          }}
        />
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto p-6 max-w-6xl mx-auto" data-testid="home-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-6 h-6 text-th-text-muted" />
          <h1 className="text-xl font-semibold text-th-text-alt">Home</h1>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <StatusBadge variant="success" label="Connected" icon={<Wifi className="w-3 h-3" />} />
          ) : (
            <StatusBadge variant="error" label="Disconnected" icon={<WifiOff className="w-3 h-3" />} />
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6" data-testid="home-stats">
        <StatCard
          icon={<FolderOpen className="w-4 h-4" />}
          label="Active Projects"
          value={projects.length}
        />
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Running Agents"
          value={totalRunningAgents}
          accent
        />
        <StatCard
          icon={<Bell className="w-4 h-4" />}
          label="Needs Attention"
          value={attentionItems.length}
          accent={attentionItems.length > 0}
        />
      </div>

      {/* Attention Queue */}
      {attentionItems.length > 0 && (
        <div className="mb-6" data-testid="attention-queue">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-medium text-th-text-alt">Needs Your Attention</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 font-medium">
              {attentionItems.length}
            </span>
          </div>
          <div className="bg-surface-raised border border-th-border rounded-lg divide-y divide-th-border">
            {attentionItems.slice(0, 5).map((item) => (
              <AttentionQueueItem
                key={item.id}
                item={item}
                onClick={() => {
                  if (item.projectId) handleNavigateToProject(item.projectId);
                }}
              />
            ))}
            {attentionItems.length > 5 && (
              <div className="px-3 py-2 text-[11px] text-th-text-muted text-center">
                +{attentionItems.length - 5} more item{attentionItems.length - 5 > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Projects Grid */}
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
              onClick={() => handleNavigateToProject(project.id)}
            />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleNavigateToProjects}
          className="flex items-center gap-1.5 px-4 py-2 text-xs text-th-text-muted hover:text-th-text rounded-lg hover:bg-th-bg-muted transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          Start New Session
        </button>
      </div>
    </div>
  );
}
