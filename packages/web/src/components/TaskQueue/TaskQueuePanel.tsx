import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { LayoutList, Network, Users, CheckCircle2, XCircle, Loader2, Play, Archive, Clock, BarChart2, Columns3, SplitSquareHorizontal } from 'lucide-react';
import { EmptyState } from '../Shared';
import { TaskDagPanelContent } from '../LeadDashboard/TaskDagPanel';
import { DagGraph } from './DagGraph';
import { DagGantt } from './DagGantt';
import { DagResourceView } from './DagResourceView';
import { KanbanBoard } from './KanbanBoard';
import { useOptionalProjectId } from '../../contexts/ProjectContext';
import type { GanttTask } from './DagGantt';
import type { DagStatus, LeadProgress, AgentInfo, Project } from '../../types';
import { shortAgentId } from '../../utils/agentLabel';

interface Props {
  api: any;
}

/** Parse a SQLite datetime string, normalizing missing Z suffix to UTC */
function parseDbTimestamp(ts: string): number {
  return new Date(ts.endsWith('Z') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
}

// ---------------------------------------------------------------------------
// Progress summary for a lead session
// ---------------------------------------------------------------------------
function SessionProgress({ progress, dagStatus }: { progress: LeadProgress | null; dagStatus: DagStatus | null }) {
  const delegationTotal = progress?.totalDelegations ?? 0;
  const delegationCompleted = progress?.completed ?? 0;
  const delegationFailed = progress?.failed ?? 0;
  const delegationActive = progress?.active ?? 0;
  const completionPct = progress?.completionPct ?? 0;

  const dagTotal = dagStatus?.tasks.length ?? 0;
  const dagDone = dagStatus?.summary.done ?? 0;
  const dagRunning = dagStatus?.summary.running ?? 0;
  const dagFailed = dagStatus?.summary.failed ?? 0;
  const dagPct = dagTotal > 0 ? Math.round((dagDone / dagTotal) * 100) : 0;

  const hasDag = dagTotal > 0;
  const hasDelegations = delegationTotal > 0;

  if (!hasDag && !hasDelegations) {
    return <EmptyState icon="📋" title="No tasks or delegations yet" compact />;
  }

  return (
    <div className="space-y-3">
      {/* DAG progress */}
      {hasDag && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-th-text-muted font-medium">DAG Tasks</span>
            <span className="text-xs text-th-text-alt">{dagDone}/{dagTotal} done ({dagPct}%)</span>
          </div>
          <div className="w-full h-2 bg-th-bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 transition-all duration-300 rounded-full" style={{ width: `${dagPct}%` }} />
          </div>
          <div className="flex gap-3 mt-1 text-[11px]">
            {dagRunning > 0 && <span className="text-blue-400">🔵 {dagRunning} running</span>}
            {dagDone > 0 && <span className="text-purple-400">✅ {dagDone} done</span>}
            {dagFailed > 0 && <span className="text-red-400">❌ {dagFailed} failed</span>}
            {(dagStatus?.summary.pending ?? 0) > 0 && <span className="text-th-text-muted">⏳ {dagStatus!.summary.pending} pending</span>}
            {(dagStatus?.summary.ready ?? 0) > 0 && <span className="text-green-400">🟢 {dagStatus!.summary.ready} ready</span>}
          </div>
        </div>
      )}

      {/* Delegation progress */}
      {hasDelegations && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-th-text-muted font-medium">Delegations</span>
            <span className="text-xs text-th-text-alt">{delegationCompleted}/{delegationTotal} ({completionPct}%)</span>
          </div>
          <div className="w-full h-2 bg-th-bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-300 rounded-full" style={{ width: `${completionPct}%` }} />
          </div>
          <div className="flex gap-3 mt-1 text-[11px]">
            {delegationActive > 0 && <span className="text-blue-400"><Loader2 size={10} className="inline animate-spin mr-0.5" />{delegationActive} active</span>}
            {delegationCompleted > 0 && <span className="text-purple-400"><CheckCircle2 size={10} className="inline mr-0.5" />{delegationCompleted} completed</span>}
            {delegationFailed > 0 && <span className="text-red-400"><XCircle size={10} className="inline mr-0.5" />{delegationFailed} failed</span>}
          </div>
        </div>
      )}

      {/* Crew agents */}
      {progress && progress.crewAgents.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Users size={12} className="text-th-text-muted" />
            <span className="text-xs text-th-text-muted font-medium">Crew ({progress.crewSize})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {progress.crewAgents.map((a) => (
              <span
                key={a.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
                  a.status === 'running' ? 'border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-300' :
                  a.status === 'idle' ? 'border-gray-500/50 bg-gray-500/10 text-gray-600 dark:text-gray-300' :
                  a.status === 'completed' ? 'border-purple-500/50 bg-purple-500/10 text-purple-600 dark:text-purple-300' :
                  a.status === 'failed' ? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-300' :
                  a.status === 'terminated' ? 'border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-300' :
                  'border-th-border text-th-text-muted'
                }`}
              >
                {a.role?.icon} {a.role?.name ?? 'Unknown'}
                {a.task && <span className="text-th-text-muted max-w-[80px] truncate">— {a.task}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable DAG task visualization panel
// ---------------------------------------------------------------------------

type TaskViewMode = 'graph' | 'list' | 'gantt' | 'resource' | 'kanban' | 'split';

function DagPanel({
  dagStatus,
  dagView,
  setDagView,
  projectId,
  onTaskUpdated,
}: {
  dagStatus: DagStatus | null;
  dagView: TaskViewMode | null;
  setDagView: (v: TaskViewMode | null) => void;
  projectId?: string;
  onTaskUpdated?: () => void;
}) {
  const [kanbanScope, setKanbanScope] = useState<'project' | 'global'>('project');
  const [globalDagStatus, setGlobalDagStatus] = useState<DagStatus | null>(null);
  const [globalHasMore, setGlobalHasMore] = useState(false);
  const [globalOffset, setGlobalOffset] = useState(0);
  const [showArchived, setShowArchived] = useState(() => {
    try { return localStorage.getItem('kanban-show-archived') === 'true'; } catch { return false; }
  });
  const handleShowArchivedChange = useCallback((v: boolean) => {
    setShowArchived(v);
    try { localStorage.setItem('kanban-show-archived', String(v)); } catch { /* ignore */ }
  }, []);
  const GLOBAL_PAGE_SIZE = 200;
  const [projectNameMap, setProjectNameMap] = useState<Map<string, string>>(new Map());
  const effectiveView = dagView ?? 'split';
  const archivedParam = showArchived ? '&includeArchived=true' : '';

  // Fetch global tasks when scope=global and view=kanban/split
  useEffect(() => {
    if (kanbanScope !== 'global' || (effectiveView !== 'kanban' && effectiveView !== 'split')) return;
    let cancelled = false;
    const fetchGlobal = async () => {
      try {
        const data = await apiFetch<{ tasks: any[]; total: number; hasMore: boolean; offset: number; limit: number }>(`/tasks?scope=global&limit=${GLOBAL_PAGE_SIZE}&offset=0${archivedParam}`);
        if (!cancelled && data) {
          const tasks = data.tasks;
          setGlobalDagStatus({
            tasks,
            fileLockMap: {},
            summary: {
              pending: tasks.filter((t: any) => t.dagStatus === 'pending').length,
              ready: tasks.filter((t: any) => t.dagStatus === 'ready').length,
              running: tasks.filter((t: any) => t.dagStatus === 'running').length,
              blocked: tasks.filter((t: any) => t.dagStatus === 'blocked').length,
              done: tasks.filter((t: any) => t.dagStatus === 'done').length,
              failed: tasks.filter((t: any) => t.dagStatus === 'failed').length,
              paused: tasks.filter((t: any) => t.dagStatus === 'paused').length,
              skipped: tasks.filter((t: any) => t.dagStatus === 'skipped').length,
            },
          });
          setGlobalHasMore(data.hasMore);
          setGlobalOffset(data.offset + data.limit);
        }
      } catch (err) {
        console.warn('Failed to fetch global tasks', err);
      }
    };
    fetchGlobal();
    const interval = setInterval(fetchGlobal, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [kanbanScope, effectiveView, showArchived]);

  // Fetch project names for global view
  useEffect(() => {
    if (kanbanScope !== 'global') return;
    apiFetch<Project[]>('/projects')
      .then(projects => {
        const map = new Map<string, string>();
        for (const p of projects) map.set(p.id, p.name);
        setProjectNameMap(map);
      })
      .catch(() => { /* data will load on next poll */ });
  }, [kanbanScope]);

  // Load next page of global tasks (appends to existing)
  const loadMoreGlobalTasks = async () => {
    if (!globalHasMore || !globalDagStatus) return;
    try {
      const data = await apiFetch<{ tasks: any[]; total: number; hasMore: boolean; offset: number; limit: number }>(`/tasks?scope=global&limit=${GLOBAL_PAGE_SIZE}&offset=${globalOffset}${archivedParam}`);
      if (data) {
        const merged = [...globalDagStatus.tasks, ...data.tasks];
        setGlobalDagStatus({
          tasks: merged,
          fileLockMap: {},
          summary: {
            pending: merged.filter((t: any) => t.dagStatus === 'pending').length,
            ready: merged.filter((t: any) => t.dagStatus === 'ready').length,
            running: merged.filter((t: any) => t.dagStatus === 'running').length,
            blocked: merged.filter((t: any) => t.dagStatus === 'blocked').length,
            done: merged.filter((t: any) => t.dagStatus === 'done').length,
            failed: merged.filter((t: any) => t.dagStatus === 'failed').length,
            paused: merged.filter((t: any) => t.dagStatus === 'paused').length,
            skipped: merged.filter((t: any) => t.dagStatus === 'skipped').length,
          },
        });
        setGlobalHasMore(data.hasMore);
        setGlobalOffset(data.offset + data.limit);
      }
    } catch (err) {
      console.warn('Failed to load more global tasks', err);
    }
  };

  const kanbanProps = {
    dagStatus: kanbanScope === 'global' ? globalDagStatus : dagStatus,
    projectId: kanbanScope === 'global' ? undefined : projectId,
    onTaskUpdated: kanbanScope === 'global' ? undefined : onTaskUpdated,
    scope: kanbanScope as 'project' | 'global',
    projectNameMap,
    hasMore: kanbanScope === 'global' ? globalHasMore : false,
    onLoadMore: kanbanScope === 'global' ? loadMoreGlobalTasks : undefined,
    showArchived,
    onShowArchivedChange: handleShowArchivedChange,
  };

  const ganttTasks: GanttTask[] = (dagStatus?.tasks ?? []).map((t) => ({
    id:          t.id,
    title:       t.title || t.description || t.id,
    status:      ((new Set<string>(['pending','running','done','failed','blocked','skipped']))
                   .has(t.dagStatus)
                   ? t.dagStatus as GanttTask['status']
                   : 'pending',
    assignee:    t.role,
    dependsOn:   t.dependsOn,
    createdAt:   parseDbTimestamp(t.createdAt),
    startedAt:   t.startedAt ? parseDbTimestamp(t.startedAt) : undefined,
    completedAt: t.completedAt ? parseDbTimestamp(t.completedAt) : undefined,
  }));

  const viewIcon =
    effectiveView === 'split' ? <SplitSquareHorizontal size={14} className="text-teal-400" /> :
    effectiveView === 'graph' ? <Network size={14} className="text-blue-400" /> :
    effectiveView === 'gantt' ? <BarChart2 size={14} className="text-purple-400" /> :
    effectiveView === 'resource' ? <Users size={14} className="text-cyan-400" /> :
    effectiveView === 'kanban' ? <Columns3 size={14} className="text-emerald-400" /> :
    <LayoutList size={14} className="text-blue-400" />;

  return (
    <div className="bg-th-bg-alt/50 rounded-lg border border-th-border flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 border-b border-th-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-th-text flex items-center gap-2">
          {viewIcon}
          Tasks
          {dagStatus && (
            <span className="text-xs text-th-text-muted font-normal">{dagStatus.tasks.length} total</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {/* Scope switcher (only shown when NOT inside a specific project) */}
          {!projectId && (effectiveView === 'kanban' || effectiveView === 'split') && (
            <select
              value={kanbanScope}
              onChange={(e) => setKanbanScope(e.target.value as 'project' | 'global')}
              className="text-[11px] bg-th-bg border border-th-border rounded px-2 py-1 text-th-text cursor-pointer"
              data-testid="scope-switcher"
            >
              <option value="project">📁 This Project</option>
              <option value="global">🌐 All Projects</option>
            </select>
          )}
          <div className="flex bg-th-bg rounded p-0.5 border border-th-border">
          <button
            onClick={() => setDagView('split')}
            className={`p-1 rounded transition-colors ${
              effectiveView === 'split' ? 'bg-th-bg-muted text-th-text' : 'text-th-text-muted hover:text-th-text-alt'
            }`}
            title="Split view (Kanban + Graph)"
            data-testid="view-split"
          >
            <SplitSquareHorizontal size={13} />
          </button>
          <button
            onClick={() => setDagView('kanban')}
            className={`p-1 rounded transition-colors ${
              effectiveView === 'kanban' ? 'bg-th-bg-muted text-th-text' : 'text-th-text-muted hover:text-th-text-alt'
            }`}
            title="Kanban board"
          >
            <Columns3 size={13} />
          </button>
          <button
            onClick={() => setDagView('graph')}
            className={`p-1 rounded transition-colors ${
              effectiveView === 'graph' ? 'bg-th-bg-muted text-th-text' : 'text-th-text-muted hover:text-th-text-alt'
            }`}
            title="Graph view"
          >
            <Network size={13} />
          </button>
          <button
            onClick={() => setDagView('list')}
            className={`p-1 rounded transition-colors ${
              effectiveView === 'list' ? 'bg-th-bg-muted text-th-text' : 'text-th-text-muted hover:text-th-text-alt'
            }`}
            title="List view"
          >
            <LayoutList size={13} />
          </button>
          <button
            onClick={() => setDagView('gantt')}
            className={`p-1 rounded transition-colors ${
              effectiveView === 'gantt' ? 'bg-th-bg-muted text-th-text' : 'text-th-text-muted hover:text-th-text-alt'
            }`}
            title="Gantt view"
          >
            <BarChart2 size={13} />
          </button>
          <button
            onClick={() => setDagView('resource')}
            className={`p-1 rounded transition-colors ${
              effectiveView === 'resource' ? 'bg-th-bg-muted text-th-text' : 'text-th-text-muted hover:text-th-text-alt'
            }`}
            title="Resource view"
          >
            <Users size={13} />
          </button>
        </div>
        </div>
      </div>
      {effectiveView === 'split' ? (
        /* Split view: DAG on top, Kanban below (simple vertical stack) */
        <div className="flex flex-col w-full flex-1 gap-2" data-testid="split-view">
          {/* DAG graph */}
          <div className="overflow-hidden" style={{ height: 350 }}>
            <DagGraph dagStatus={dagStatus} fillContainer />
          </div>

          {/* Kanban board */}
          <div className="flex-1 overflow-auto">
            <KanbanBoard {...kanbanProps} />
          </div>
        </div>
      ) : effectiveView === 'kanban' ? (
        <div style={{ minHeight: 400 }}>
          <KanbanBoard {...kanbanProps} />
        </div>
      ) : effectiveView === 'graph' ? (
        <div className="flex-1" style={{ minHeight: 400 }}>
          <DagGraph dagStatus={dagStatus} />
        </div>
      ) : effectiveView === 'gantt' ? (
        <div className="p-4 overflow-auto" style={{ maxHeight: 520 }}>
          <DagGantt tasks={ganttTasks} />
        </div>
      ) : effectiveView === 'resource' ? (
        <div className="max-h-[500px] overflow-y-auto">
          <DagResourceView dagStatus={dagStatus} />
        </div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto">
          <TaskDagPanelContent dagStatus={dagStatus} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab item — either an active lead or a persisted (inactive) project
// ---------------------------------------------------------------------------
type TabItem =
  | { type: 'active'; leadId: string; agent: AgentInfo; project?: Project }
  | { type: 'persisted'; project: Project };

function tabKey(tab: TabItem): string {
  return tab.type === 'active' ? tab.leadId : `proj-${tab.project.id}`;
}

// ---------------------------------------------------------------------------
// Main TaskQueuePanel — tabbed by project
// ---------------------------------------------------------------------------
export function TaskQueuePanel({ api }: Props) {
  const agents = useAppStore((s) => s.agents);
  const leadProjects = useLeadStore((s) => s.projects);
  const projectId = useOptionalProjectId();
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [progress, setProgress] = useState<LeadProgress | null>(null);
  const [dagView, setDagView] = useState<TaskViewMode | null>(null);
  const [persistedProjects, setPersistedProjects] = useState<Project[]>([]);
  const [resuming, setResuming] = useState<string | null>(null);
  const [historicalDag, setHistoricalDag] = useState<DagStatus | null>(null);

  const leads = agents.filter((a: AgentInfo) => a.role?.id === 'lead' && !a.parentId);

  // Fetch persisted projects from API
  useEffect(() => {
    apiFetch<Project[]>('/projects')
      .then((data) => setPersistedProjects(Array.isArray(data) ? data : []))
      .catch(() => { /* data will load on next poll */ });
  }, [leads.length]); // re-fetch when leads change

  // Build tabs: active leads + inactive persisted projects
  const activeLeadProjectIds = new Set(leads.map((l: AgentInfo) => l.projectId).filter(Boolean));
  const tabs: TabItem[] = [
    ...leads.map((l: AgentInfo): TabItem => ({
      type: 'active',
      leadId: l.id,
      agent: l,
      project: persistedProjects.find(p => p.id === l.projectId),
    })),
    ...persistedProjects
      .filter(p => !activeLeadProjectIds.has(p.id) && p.status !== 'archived')
      .map((p): TabItem => ({ type: 'persisted', project: p })),
  ];

  // Auto-select first tab (or project-scoped tab if inside ProjectLayout)
  useEffect(() => {
    if (projectId) {
      // Inside a project — find the matching tab
      const match = tabs.find(t =>
        (t.type === 'active' && t.agent.projectId === projectId) ||
        (t.type === 'persisted' && t.project.id === projectId),
      );
      if (match) setSelectedTab(tabKey(match));
    } else if (tabs.length > 0 && (!selectedTab || !tabs.some(t => tabKey(t) === selectedTab))) {
      setSelectedTab(tabKey(tabs[0]));
    }
  }, [tabs.length, selectedTab, projectId]);

  // Selected tab data
  const currentTab = tabs.find(t => tabKey(t) === selectedTab);
  const activeLeadId = currentTab?.type === 'active' ? currentTab.leadId : null;

  // Fetch project details (with sessions) for persisted tabs
  useEffect(() => {
    if (currentTab?.type === 'persisted' && !currentTab.project.sessions) {
      apiFetch<Project>(`/projects/${currentTab.project.id}`)
        .then((data) => {
          if (data) setPersistedProjects(prev => prev.map(p => p.id === data.id ? data : p));
        })
        .catch(() => { /* data will load on next poll */ });
    }
  }, [selectedTab, currentTab?.type]);

  // Fetch historical DAG tasks for persisted projects
  useEffect(() => {
    if (currentTab?.type !== 'persisted') {
      setHistoricalDag(null);
      return;
    }
    apiFetch<DagStatus>(`/projects/${currentTab.project.id}/dag?includeArchived=true`)
      .then((data) => {
        if (data?.tasks?.length > 0) setHistoricalDag(data);
      })
      .catch(() => { /* data will load on next poll */ });
  }, [selectedTab, currentTab?.type]);

  // Fetch progress + DAG for active leads
  const fetchData = useCallback(async (leadId: string) => {
    try {
      const [dagData, progressData] = await Promise.all([
        api.fetchDagStatus(leadId),
        apiFetch<LeadProgress>(`/lead/${leadId}/progress`),
      ]);
      if (dagData) useLeadStore.getState().setDagStatus(leadId, dagData);
      // Normalize server-side property names (team→crew rename, Phase 1)
      const raw = progressData as LeadProgress & { teamAgents?: LeadProgress['crewAgents']; teamSize?: number };
      setProgress({
        ...progressData,
        crewAgents: progressData.crewAgents ?? raw.teamAgents ?? [],
        crewSize: progressData.crewSize ?? raw.teamSize ?? 0,
      });
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => {
    if (activeLeadId) fetchData(activeLeadId);
  }, [activeLeadId, fetchData]);

  useEffect(() => {
    if (!activeLeadId) return;
    const lead = agents.find((a: AgentInfo) => a.id === activeLeadId);
    if (!lead || lead.status === 'completed' || lead.status === 'failed' || lead.status === 'terminated') return;
    const interval = setInterval(() => fetchData(activeLeadId), 5000);
    return () => clearInterval(interval);
  }, [activeLeadId, agents, fetchData]);

  const leadProject = activeLeadId ? leadProjects[activeLeadId] : null;
  const dagStatus: DagStatus | null = leadProject?.dagStatus ?? null;

  // Resume a persisted project
  const handleResume = async (projectId: string) => {
    setResuming(projectId);
    try {
      const agent = await apiFetch<{ id: string }>(`/projects/${projectId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (agent?.id) {
        setTimeout(() => setSelectedTab(agent.id), 500);
      }
    } catch { /* ignore */ }
    setResuming(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ---- Project tabs (hidden when inside ProjectLayout) ---- */}
      {!projectId && (
      <div className="flex items-center border-b border-th-border shrink-0 overflow-x-auto bg-th-bg">
        {tabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 h-10 text-th-text-muted text-sm">
            <Network size={14} />
            No projects yet
          </div>
        ) : (
          tabs.map((tab) => {
            const key = tabKey(tab);
            const isSelected = selectedTab === key;

            if (tab.type === 'active') {
              const l = tab.agent;
              const projState = leadProjects[l.id];
              const dagSummary = projState?.dagStatus?.summary;
              const taskCount = projState?.dagStatus?.tasks.length ?? 0;
              const doneCount = dagSummary?.done ?? 0;

              return (
                <button
                  key={key}
                  onClick={() => setSelectedTab(key)}
                  className={`flex items-center gap-2 px-4 h-10 text-sm border-b-2 whitespace-nowrap transition-colors shrink-0 ${
                    isSelected
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-transparent text-th-text-muted hover:text-th-text hover:bg-th-bg-muted/50'
                  }`}
                >
                  <span className="font-medium max-w-[160px] truncate">
                    {l.projectName || shortAgentId(l.id)}
                  </span>
                  {taskCount > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 rounded-full min-w-[18px] text-center ${
                      doneCount === taskCount
                        ? 'bg-purple-900/50 text-purple-400'
                        : 'bg-th-bg-alt text-th-text-muted'
                    }`}>
                      {doneCount}/{taskCount}
                    </span>
                  )}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    l.status === 'running' ? 'bg-blue-400 animate-pulse' :
                    l.status === 'idle' ? 'bg-gray-400' :
                    l.status === 'completed' ? 'bg-purple-400' :
                    l.status === 'terminated' ? 'bg-orange-400' :
                    'bg-red-400'
                  }`} />
                </button>
              );
            }

            // Persisted (inactive) project tab
            const p = tab.project;
            return (
              <button
                key={key}
                onClick={() => setSelectedTab(key)}
                className={`flex items-center gap-2 px-4 h-10 text-sm border-b-2 whitespace-nowrap transition-colors shrink-0 ${
                  isSelected
                    ? 'border-th-border text-th-text-alt bg-th-bg-muted/30'
                    : 'border-transparent text-th-text-muted hover:text-th-text-alt hover:bg-th-bg-muted/30'
                }`}
              >
                <Archive size={12} className="opacity-50" />
                <span className="font-medium max-w-[160px] truncate">{p.name}</span>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-th-bg-hover" />
              </button>
            );
          })
        )}
      </div>
      )}

      {/* ---- Content for selected tab ---- */}
      <div className="flex-1 overflow-auto p-2 focus:outline-none" tabIndex={0}>
        {!currentTab ? (
          <div className="flex flex-col items-center justify-center py-12 text-th-text-muted">
            <Network size={32} className="mb-2 opacity-50" />
            <p className="text-sm">No lead sessions active</p>
            <p className="text-xs mt-1">Start a lead agent to see project tasks here</p>
          </div>
        ) : currentTab.type === 'persisted' ? (
          /* Inactive project — show summary, DAG tasks, and resume button */
          <div className="space-y-4 max-w-2xl mx-auto">
            <div className="bg-th-bg-alt/50 rounded-lg border border-th-border p-6">
              <h3 className="text-lg font-semibold text-th-text mb-2">{currentTab.project.name}</h3>
              {currentTab.project.description && (
                <p className="text-sm text-th-text-muted mb-4">{currentTab.project.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-th-text-muted mb-6">
                <span className="flex items-center gap-1"><Clock size={12} /> Created {new Date(currentTab.project.createdAt).toLocaleDateString()}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> Updated {new Date(currentTab.project.updatedAt).toLocaleDateString()}</span>
                {currentTab.project.cwd && <span className="text-th-text-muted truncate max-w-[200px]">📂 {currentTab.project.cwd}</span>}
              </div>
              {currentTab.project.sessions && currentTab.project.sessions.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-medium text-th-text-muted uppercase mb-2">Previous Sessions</h4>
                  <div className="space-y-1">
                    {currentTab.project.sessions.slice(0, 5).map(s => (
                      <div key={s.id} className="flex items-center gap-2 text-xs text-th-text-muted">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'completed' ? 'bg-purple-500' :
                          s.status === 'crashed' ? 'bg-red-500' : 'bg-gray-500'
                        }`} />
                        <span>{s.task?.slice(0, 60) || 'No task'}</span>
                        <span className="text-th-text-muted">— {new Date(s.startedAt).toLocaleDateString()}</span>
                        <span className={s.status === 'crashed' ? 'text-red-400' : 'text-th-text-muted'}>
                          ({s.status})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={() => handleResume(currentTab.project.id)}
                disabled={resuming === currentTab.project.id}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
              >
                {resuming === currentTab.project.id ? (
                  <><Loader2 size={14} className="animate-spin" /> Resuming…</>
                ) : (
                  <><Play size={14} /> Resume Project</>
                )}
              </button>
            </div>

            {/* Historical DAG tasks */}
            {historicalDag && historicalDag.tasks.length > 0 && (
              <>
                <div className="bg-th-bg-alt/50 rounded-lg border border-th-border p-4">
                  <h3 className="text-sm font-medium text-th-text mb-3 flex items-center gap-2">
                    <Network size={14} className="text-cyan-400" />
                    Progress (historical)
                  </h3>
                  <SessionProgress progress={null} dagStatus={historicalDag} />
                </div>
                <DagPanel dagStatus={historicalDag} dagView={dagView} setDagView={setDagView} projectId={currentTab.project.id} />
              </>
            )}
          </div>
        ) : (
          /* Active lead — show progress and tasks */
          <div className="space-y-2 flex flex-col flex-1 min-h-0">
            <div className="bg-th-bg-alt/50 rounded-lg border border-th-border p-3 shrink-0">
              <h3 className="text-sm font-medium text-th-text mb-2 flex items-center gap-2">
                <Network size={14} className="text-cyan-400" />
                Progress
              </h3>
              <SessionProgress progress={progress} dagStatus={dagStatus} />
            </div>

            <DagPanel dagStatus={dagStatus} dagView={dagView} setDagView={setDagView} projectId={currentTab.type === 'active' ? (currentTab.agent?.projectId ?? currentTab.project?.id) : undefined} onTaskUpdated={activeLeadId ? () => fetchData(activeLeadId) : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}
