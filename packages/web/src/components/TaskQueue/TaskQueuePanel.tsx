import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { Plus, Trash2, GripVertical, LayoutList, Network, Users, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { TaskDetail } from './TaskDetail';
import { TaskDagPanelContent } from '../LeadDashboard/TaskDagPanel';
import { DagGraph } from './DagGraph';
import type { Task, DagStatus, LeadProgress, AgentInfo } from '../../types';
import { SkeletonRow } from '../Skeleton';

interface Props {
  api: any;
}

const STATUS_BADGES: Record<string, { color: string; label: string }> = {
  queued: { color: 'bg-gray-500', label: 'Queued' },
  assigned: { color: 'bg-blue-500', label: 'Assigned' },
  in_progress: { color: 'bg-yellow-500', label: 'In Progress' },
  review: { color: 'bg-purple-500', label: 'Review' },
  done: { color: 'bg-green-500', label: 'Done' },
  failed: { color: 'bg-red-500', label: 'Failed' },
};

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
// Sessions tab: per-lead DAG view
// ---------------------------------------------------------------------------
function SessionsView({ api }: { api: any }) {
  const { agents } = useAppStore();
  const { projects } = useLeadStore();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [progress, setProgress] = useState<LeadProgress | null>(null);
  const [dagView, setDagView] = useState<'graph' | 'list' | null>(null);

  // Find all leads
  const leads = agents.filter((a: AgentInfo) => a.role?.id === 'lead' && !a.parentId);

  // Auto-select first lead
  useEffect(() => {
    if (!selectedLeadId && leads.length > 0) setSelectedLeadId(leads[0].id);
    if (selectedLeadId && !leads.some((l: AgentInfo) => l.id === selectedLeadId) && leads.length > 0) {
      setSelectedLeadId(leads[0].id);
    }
  }, [leads, selectedLeadId]);

  // Fetch progress and DAG on lead selection
  const fetchData = useCallback(async (leadId: string) => {
    try {
      const [dagData, progressData] = await Promise.all([
        api.fetchDagStatus(leadId),
        fetch(`/api/lead/${leadId}/progress`).then((r: Response) => r.json()),
      ]);
      if (dagData) useLeadStore.getState().setDagStatus(leadId, dagData);
      setProgress(progressData);
    } catch { /* ignore fetch errors */ }
  }, [api]);

  useEffect(() => {
    if (selectedLeadId) fetchData(selectedLeadId);
  }, [selectedLeadId, fetchData]);

  // Also re-fetch periodically while lead is active
  useEffect(() => {
    if (!selectedLeadId) return;
    const lead = agents.find((a: AgentInfo) => a.id === selectedLeadId);
    if (!lead || lead.status === 'completed' || lead.status === 'failed') return;
    const interval = setInterval(() => fetchData(selectedLeadId), 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId, agents, fetchData]);

  const project = selectedLeadId ? projects[selectedLeadId] : null;
  const dagStatus: DagStatus | null = project?.dagStatus ?? null;

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Network size={32} className="mb-2 opacity-50" />
        <p className="text-sm">No lead sessions active</p>
        <p className="text-xs mt-1">Start a lead agent to see session tasks here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Lead selector */}
      {leads.length > 1 && (
        <div className="flex gap-2 items-center flex-wrap">
          {leads.map((l: AgentInfo) => {
            const isSelected = selectedLeadId === l.id;
            const projState = projects[l.id];
            const dagSummary = projState?.dagStatus?.summary;
            const taskCount = projState?.dagStatus?.tasks.length ?? 0;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedLeadId(l.id)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:border-gray-600'
                }`}
              >
                <span className="font-medium">{l.projectName || l.id.slice(0, 8)}</span>
                {taskCount > 0 && dagSummary && (
                  <span className="ml-1.5 text-xs text-gray-500">
                    ({dagSummary.done}/{taskCount})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Progress summary */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <Network size={14} className="text-cyan-400" />
          Session Progress
          {selectedLeadId && (
            <span className="text-xs text-gray-500 font-normal">
              {leads.find((l: AgentInfo) => l.id === selectedLeadId)?.projectName || selectedLeadId.slice(0, 8)}
            </span>
          )}
        </h3>
        <SessionProgress progress={progress} dagStatus={dagStatus} />
      </div>

      {/* DAG tasks */}
      {(() => {
        // Default to graph when there are tasks with dependencies, list otherwise
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
              {/* View toggle */}
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
  );
}

// ---------------------------------------------------------------------------
// Main TaskQueuePanel with tabs
// ---------------------------------------------------------------------------
export function TaskQueuePanel({ api }: Props) {
  const { tasks, roles, loading } = useAppStore();
  const { agents } = useAppStore();
  const [tab, setTab] = useState<'sessions' | 'queue'>(() => {
    // Default to sessions if there are leads
    return agents.some((a: AgentInfo) => a.role?.id === 'lead' && !a.parentId) ? 'sessions' : 'queue';
  });
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState(0);
  const [newRole, setNewRole] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await api.createTask(newTitle, newDescription, newPriority, newRole || undefined);
    setNewTitle('');
    setNewDescription('');
    setNewPriority(0);
    setNewRole('');
    setShowCreate(false);
  };

  const grouped = {
    active: tasks.filter((t) => ['assigned', 'in_progress', 'review'].includes(t.status)),
    queued: tasks.filter((t) => t.status === 'queued'),
    completed: tasks.filter((t) => ['done', 'failed'].includes(t.status)),
  };

  const leadCount = agents.filter((a: AgentInfo) => a.role?.id === 'lead' && !a.parentId).length;

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Header with tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Tasks</h2>
          <div className="flex bg-gray-800 rounded-lg p-0.5 border border-gray-700">
            <button
              onClick={() => setTab('sessions')}
              className={`px-3 py-1 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                tab === 'sessions' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Network size={12} />
              Sessions
              {leadCount > 0 && <span className="text-[10px] bg-gray-600 text-gray-300 px-1 rounded">{leadCount}</span>}
            </button>
            <button
              onClick={() => setTab('queue')}
              className={`px-3 py-1 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                tab === 'queue' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutList size={12} />
              Queue
              {tasks.length > 0 && <span className="text-[10px] bg-gray-600 text-gray-300 px-1 rounded">{tasks.length}</span>}
            </button>
          </div>
        </div>
        {tab === 'queue' && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-black rounded-lg text-sm font-medium hover:bg-accent-muted transition-colors"
          >
            <Plus size={16} />
            New Task
          </button>
        )}
      </div>

      {/* Sessions tab */}
      {tab === 'sessions' && <SessionsView api={api} />}

      {/* Queue tab (original) */}
      {tab === 'queue' && (
        <>
          {showCreate && (
            <div className="bg-surface-raised border border-gray-700 rounded-lg p-4 mb-4">
              <input
                type="text"
                placeholder="Task title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-surface border border-gray-700 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-accent"
              />
              <textarea
                placeholder="Description (optional)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                className="w-full bg-surface border border-gray-700 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-accent resize-none"
              />
              <div className="flex gap-2 mb-3">
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(Number(e.target.value))}
                  className="bg-surface border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
                >
                  <option value={0}>Normal Priority</option>
                  <option value={1}>High Priority</option>
                  <option value={2}>Urgent</option>
                </select>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="bg-surface border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Any role</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.icon} {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newTitle.trim()}
                  className="px-3 py-1.5 text-sm bg-accent text-black rounded-lg font-medium disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {(['active', 'queued', 'completed'] as const).map((section) => (
            <div key={section} className="mb-6">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-2">
                {section} ({grouped[section].length})
              </h3>
              {loading && section === 'active' ? (
                <div className="space-y-2">
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </div>
              ) : grouped[section].length === 0 ? (
                <p className="text-sm text-gray-600">No tasks</p>
              ) : (
                <div className="space-y-2">
                  {grouped[section].map((task) => (
                    <TaskRow key={task.id} task={task} api={api} onClick={() => setSelectedTask(task)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          api={api}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

function TaskRow({ task, api, onClick }: { task: Task; api: any; onClick: () => void }) {
  const badge = STATUS_BADGES[task.status] || STATUS_BADGES.queued;
  return (
    <div
      className="flex items-center gap-3 bg-surface-raised border border-gray-700 rounded-lg p-3 cursor-pointer hover:border-gray-500 transition-colors"
      onClick={onClick}
    >
      <GripVertical size={14} className="text-gray-600 cursor-grab" />
      <span className={`w-2 h-2 rounded-full shrink-0 ${badge.color}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{task.title}</div>
        {task.description && (
          <div className="text-xs text-gray-500 truncate">{task.description}</div>
        )}
      </div>
      <span className="text-[10px] text-gray-500 font-mono shrink-0">{badge.label}</span>
      <button
        onClick={(e) => { e.stopPropagation(); api.deleteTask(task.id); }}
        className="p-1 text-gray-500 hover:text-red-400 shrink-0"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
