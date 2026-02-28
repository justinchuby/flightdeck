import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { LayoutList, Network, Users, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { TaskDagPanelContent } from '../LeadDashboard/TaskDagPanel';
import { DagGraph } from './DagGraph';
import type { DagStatus, LeadProgress, AgentInfo } from '../../types';

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
// Main TaskQueuePanel — shows only the Sessions/DAG view
// ---------------------------------------------------------------------------
export function TaskQueuePanel({ api }: Props) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Sessions</h2>
      </div>
      <SessionsView api={api} />
    </div>
  );
}
