import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { LayoutList, Network, Users, CheckCircle2, XCircle, Loader2, Play, Archive, Clock } from 'lucide-react';
import { TaskDagPanelContent } from '../LeadDashboard/TaskDagPanel';
import { DagGraph } from './DagGraph';
import type { DagStatus, LeadProgress, AgentInfo, Project } from '../../types';

interface Props {
  api: any;
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
    return <div className="text-sm text-gray-500 py-2">No tasks or delegations yet</div>;
  }

  return (
    <div className="space-y-3">
      {/* DAG progress */}
      {hasDag && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400 font-medium">DAG Tasks</span>
            <span className="text-xs text-gray-300">{dagDone}/{dagTotal} done ({dagPct}%)</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-300 rounded-full" style={{ width: `${dagPct}%` }} />
          </div>
          <div className="flex gap-3 mt-1 text-[11px]">
            {dagRunning > 0 && <span className="text-blue-400">🔵 {dagRunning} running</span>}
            {dagDone > 0 && <span className="text-emerald-400">✅ {dagDone} done</span>}
            {dagFailed > 0 && <span className="text-red-400">❌ {dagFailed} failed</span>}
            {(dagStatus?.summary.pending ?? 0) > 0 && <span className="text-gray-400">⏳ {dagStatus!.summary.pending} pending</span>}
            {(dagStatus?.summary.ready ?? 0) > 0 && <span className="text-green-400">🟢 {dagStatus!.summary.ready} ready</span>}
          </div>
        </div>
      )}

      {/* Delegation progress */}
      {hasDelegations && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400 font-medium">Delegations</span>
            <span className="text-xs text-gray-300">{delegationCompleted}/{delegationTotal} ({completionPct}%)</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-300 rounded-full" style={{ width: `${completionPct}%` }} />
          </div>
          <div className="flex gap-3 mt-1 text-[11px]">
            {delegationActive > 0 && <span className="text-blue-400"><Loader2 size={10} className="inline animate-spin mr-0.5" />{delegationActive} active</span>}
            {delegationCompleted > 0 && <span className="text-emerald-400"><CheckCircle2 size={10} className="inline mr-0.5" />{delegationCompleted} completed</span>}
            {delegationFailed > 0 && <span className="text-red-400"><XCircle size={10} className="inline mr-0.5" />{delegationFailed} failed</span>}
          </div>
        </div>
      )}

      {/* Team agents */}
      {progress && progress.teamAgents.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Users size={12} className="text-gray-400" />
            <span className="text-xs text-gray-400 font-medium">Team ({progress.teamSize})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {progress.teamAgents.map((a) => (
              <span
                key={a.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
                  a.status === 'running' ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' :
                  a.status === 'idle' ? 'border-green-500/50 bg-green-500/10 text-green-300' :
                  a.status === 'completed' ? 'border-gray-500/50 bg-gray-500/10 text-gray-400' :
                  a.status === 'failed' ? 'border-red-500/50 bg-red-500/10 text-red-300' :
                  'border-gray-600 text-gray-400'
                }`}
              >
                {a.role?.icon} {a.role?.name ?? 'Unknown'}
                {a.task && <span className="text-gray-500 max-w-[80px] truncate">— {a.task}</span>}
              </span>
            ))}
          </div>
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
  const { agents } = useAppStore();
  const { projects: leadProjects } = useLeadStore();
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [progress, setProgress] = useState<LeadProgress | null>(null);
  const [dagView, setDagView] = useState<'graph' | 'list' | null>('graph');
  const [persistedProjects, setPersistedProjects] = useState<Project[]>([]);
  const [resuming, setResuming] = useState<string | null>(null);

  const leads = agents.filter((a: AgentInfo) => a.role?.id === 'lead' && !a.parentId);

  // Fetch persisted projects from API
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: Project[]) => setPersistedProjects(Array.isArray(data) ? data : []))
      .catch(() => {});
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

  // Auto-select first tab
  useEffect(() => {
    if (tabs.length > 0 && (!selectedTab || !tabs.some(t => tabKey(t) === selectedTab))) {
      setSelectedTab(tabKey(tabs[0]));
    }
  }, [tabs.length, selectedTab]);

  // Selected tab data
  const currentTab = tabs.find(t => tabKey(t) === selectedTab);
  const activeLeadId = currentTab?.type === 'active' ? currentTab.leadId : null;

  // Fetch project details (with sessions) for persisted tabs
  useEffect(() => {
    if (currentTab?.type === 'persisted' && !currentTab.project.sessions) {
      fetch(`/api/projects/${currentTab.project.id}`)
        .then(r => r.json())
        .then((data: Project) => {
          setPersistedProjects(prev => prev.map(p => p.id === data.id ? data : p));
        })
        .catch(() => {});
    }
  }, [selectedTab, currentTab?.type]);

  // Fetch progress + DAG for active leads
  const fetchData = useCallback(async (leadId: string) => {
    try {
      const [dagData, progressData] = await Promise.all([
        api.fetchDagStatus(leadId),
        fetch(`/api/lead/${leadId}/progress`).then((r: Response) => r.json()),
      ]);
      if (dagData) useLeadStore.getState().setDagStatus(leadId, dagData);
      setProgress(progressData);
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => {
    if (activeLeadId) fetchData(activeLeadId);
  }, [activeLeadId, fetchData]);

  useEffect(() => {
    if (!activeLeadId) return;
    const lead = agents.find((a: AgentInfo) => a.id === activeLeadId);
    if (!lead || lead.status === 'completed' || lead.status === 'failed') return;
    const interval = setInterval(() => fetchData(activeLeadId), 5000);
    return () => clearInterval(interval);
  }, [activeLeadId, agents, fetchData]);

  const leadProject = activeLeadId ? leadProjects[activeLeadId] : null;
  const dagStatus: DagStatus | null = leadProject?.dagStatus ?? null;

  // Resume a persisted project
  const handleResume = async (projectId: string) => {
    setResuming(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const agent = await res.json();
        // Switch to the new lead tab after a brief delay for state to propagate
        setTimeout(() => setSelectedTab(agent.id), 500);
      }
    } catch { /* ignore */ }
    setResuming(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ---- Project tabs ---- */}
      <div className="flex items-center border-b border-gray-700 shrink-0 overflow-x-auto bg-[#1a1a2e]">
        {tabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 h-10 text-gray-500 text-sm">
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
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                  }`}
                >
                  <span className="font-medium max-w-[160px] truncate">
                    {l.projectName || l.id.slice(0, 8)}
                  </span>
                  {taskCount > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 rounded-full min-w-[18px] text-center ${
                      doneCount === taskCount
                        ? 'bg-green-900/50 text-green-400'
                        : 'bg-gray-800 text-gray-400'
                    }`}>
                      {doneCount}/{taskCount}
                    </span>
                  )}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    l.status === 'running' ? 'bg-blue-400 animate-pulse' :
                    l.status === 'idle' ? 'bg-green-400' :
                    l.status === 'completed' ? 'bg-gray-500' :
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
                    ? 'border-gray-400 text-gray-300 bg-gray-700/30'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-700/30'
                }`}
              >
                <Archive size={12} className="opacity-50" />
                <span className="font-medium max-w-[160px] truncate">{p.name}</span>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-600" />
              </button>
            );
          })
        )}
      </div>

      {/* ---- Content for selected tab ---- */}
      <div className="flex-1 overflow-auto p-4">
        {!currentTab ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Network size={32} className="mb-2 opacity-50" />
            <p className="text-sm">No lead sessions active</p>
            <p className="text-xs mt-1">Start a lead agent to see project tasks here</p>
          </div>
        ) : currentTab.type === 'persisted' ? (
          /* Inactive project — show summary and resume button */
          <div className="space-y-4 max-w-2xl mx-auto">
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-2">{currentTab.project.name}</h3>
              {currentTab.project.description && (
                <p className="text-sm text-gray-400 mb-4">{currentTab.project.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-6">
                <span className="flex items-center gap-1"><Clock size={12} /> Created {new Date(currentTab.project.createdAt).toLocaleDateString()}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> Updated {new Date(currentTab.project.updatedAt).toLocaleDateString()}</span>
                {currentTab.project.cwd && <span className="text-gray-600 truncate max-w-[200px]">📂 {currentTab.project.cwd}</span>}
              </div>
              {currentTab.project.sessions && currentTab.project.sessions.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">Previous Sessions</h4>
                  <div className="space-y-1">
                    {currentTab.project.sessions.slice(0, 5).map(s => (
                      <div key={s.id} className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'completed' ? 'bg-green-500' :
                          s.status === 'crashed' ? 'bg-red-500' : 'bg-gray-500'
                        }`} />
                        <span>{s.task?.slice(0, 60) || 'No task'}</span>
                        <span className="text-gray-600">— {new Date(s.startedAt).toLocaleDateString()}</span>
                        <span className={s.status === 'crashed' ? 'text-red-400' : 'text-gray-500'}>
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
          </div>
        ) : (
          /* Active lead — show progress and tasks */
          <div className="space-y-4">
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
              <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                <Network size={14} className="text-cyan-400" />
                Progress
              </h3>
              <SessionProgress progress={progress} dagStatus={dagStatus} />
            </div>

            {(() => {
              const hasDeps = dagStatus?.tasks.some((t) => t.dependsOn.length > 0) ?? false;
              const effectiveView = dagView ?? (hasDeps ? 'graph' : 'list');
              return (
                <div className="bg-gray-800/50 rounded-lg border border-gray-700 flex flex-col">
                  <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      {effectiveView === 'graph' ? (
                        <Network size={14} className="text-blue-400" />
                      ) : (
                        <LayoutList size={14} className="text-blue-400" />
                      )}
                      Tasks
                      {dagStatus && (
                        <span className="text-xs text-gray-500 font-normal">{dagStatus.tasks.length} total</span>
                      )}
                    </h3>
                    <div className="flex bg-gray-900 rounded p-0.5 border border-gray-700">
                      <button
                        onClick={() => setDagView('list')}
                        className={`p-1 rounded transition-colors ${
                          effectiveView === 'list' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                        title="List view"
                      >
                        <LayoutList size={13} />
                      </button>
                      <button
                        onClick={() => setDagView('graph')}
                        className={`p-1 rounded transition-colors ${
                          effectiveView === 'graph' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                        title="Graph view"
                      >
                        <Network size={13} />
                      </button>
                    </div>
                  </div>
                  {effectiveView === 'graph' ? (
                    <div className="flex-1" style={{ minHeight: 400 }}>
                      <DagGraph dagStatus={dagStatus} />
                    </div>
                  ) : (
                    <div className="max-h-[500px] overflow-y-auto">
                      <TaskDagPanelContent dagStatus={dagStatus} />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
