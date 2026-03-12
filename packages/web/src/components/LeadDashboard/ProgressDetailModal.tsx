import { BarChart3, X, CheckCircle, Loader2, AlertCircle, MessageSquare } from 'lucide-react';
import type { AgentReport } from '../../stores/leadStore';
import type { LeadProgress, Delegation } from '../../types';
import { agentStatusDot } from '../../utils/statusColors';
import { shortAgentId } from '../../utils/agentLabel';
import { AgentReportBlock } from './AgentReportBlock';

interface ProgressHistoryEntry {
  summary: string;
  completed: string[];
  inProgress: string[];
  blocked: string[];
  timestamp: number;
}

interface ProgressDetailModalProps {
  progress: LeadProgress | null;
  progressHistory: ProgressHistoryEntry[];
  onClose: () => void;
}

export function ProgressDetailModal({ progress, progressHistory, onClose }: ProgressDetailModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-semibold text-th-text">Progress Detail</span>
          </div>
          <button type="button" aria-label="Close progress detail" onClick={onClose} className="text-th-text-muted hover:text-th-text">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          {/* Delegation stats */}
          {progress && progress.totalDelegations > 0 && (
            <div>
              <p className="text-xs font-semibold text-th-text-muted mb-2">Delegation Overview</p>
              <div className="flex items-center gap-4 text-sm font-mono mb-2">
                <span className="text-blue-400">{progress.crewSize} agents</span>
                <span className="text-yellow-600 dark:text-yellow-400">{progress.active} active</span>
                <span className="text-purple-400">{progress.completed} done</span>
                {progress.failed > 0 && <span className="text-red-400">{progress.failed} failed</span>}
              </div>
              <div className="w-full bg-th-bg-muted rounded-full h-2.5 mb-1">
                <div
                  className="bg-green-500 h-2.5 rounded-full transition-all"
                  style={{ width: `${progress.completionPct}%` }}
                />
              </div>
              <p className="text-xs text-th-text-muted font-mono text-right">{progress.completionPct}% complete</p>
            </div>
          )}

          {/* Agent crew roster */}
          {progress && progress.crewAgents && progress.crewAgents.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-th-text-muted mb-2">Crew Roster</p>
              <div className="space-y-1">
                {progress.crewAgents.map((ta: LeadProgress['crewAgents'][number]) => (
                  <div key={ta.id} className="flex items-center gap-2 px-2 py-1 rounded bg-th-bg-muted/50 text-xs font-mono">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${agentStatusDot(ta.status)}`} />
                    <span className="text-th-text-alt">{ta.role?.name || 'Agent'}</span>
                    <span className="text-th-text-muted">{shortAgentId(ta.id)}</span>
                    <span className="ml-auto text-th-text-muted">{ta.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Latest lead progress report */}
          {progressHistory.length > 0 && (() => {
            const latest = progressHistory[progressHistory.length - 1];
            return (
              <div>
                <p className="text-xs font-semibold text-th-text-muted mb-2">Latest Lead Report</p>
                <p className="text-sm font-mono text-th-text-alt mb-3">{latest.summary}</p>
                {latest.completed.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-purple-400 font-semibold mb-1">✓ Completed</p>
                    <ul className="space-y-0.5">
                      {latest.completed.map((item, i) => (
                        <li key={i} className="text-xs font-mono text-th-text-alt pl-4 flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {latest.inProgress.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-blue-400 font-semibold mb-1">⟳ In Progress</p>
                    <ul className="space-y-0.5">
                      {latest.inProgress.map((item, i) => (
                        <li key={i} className="text-xs font-mono text-th-text-alt pl-4 flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {latest.blocked.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-red-400 font-semibold mb-1">⚠ Blocked</p>
                    <ul className="space-y-0.5">
                      {latest.blocked.map((item, i) => (
                        <li key={i} className="text-xs font-mono text-th-text-alt pl-4 flex items-center gap-1.5">
                          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[10px] text-th-text-muted font-mono mt-2">
                  {new Date(latest.timestamp).toLocaleString()}
                </p>
              </div>
            );
          })()}

          {/* Progress history timeline */}
          {progressHistory.length > 1 && (
            <div>
              <p className="text-xs font-semibold text-th-text-muted mb-2">Progress Timeline</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {[...progressHistory].reverse().slice(1).map((snap, i) => (
                  <div key={i} className="flex items-start gap-2 border-l-2 border-th-border pl-3 py-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono text-th-text-alt">{snap.summary}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] font-mono text-th-text-muted">
                        {snap.completed.length > 0 && <span className="text-purple-500">✓{snap.completed.length}</span>}
                        {snap.inProgress.length > 0 && <span className="text-blue-400">⟳{snap.inProgress.length}</span>}
                        {snap.blocked.length > 0 && <span className="text-red-400">⚠{snap.blocked.length}</span>}
                        <span>{new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delegation details */}
          {progress && progress.delegations && progress.delegations.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-th-text-muted mb-2">Delegations</p>
              <div className="space-y-1">
                {progress.delegations.map((d: Delegation, i: number) => (
                  <div key={d.id || i} className="px-2 py-1.5 rounded bg-th-bg-muted/50 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${d.status === 'active' ? 'bg-blue-500/20 text-blue-400' : d.status === 'completed' ? 'bg-purple-500/20 text-purple-400' : d.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-th-text-muted'}`}>
                        {d.status}
                      </span>
                      <span className="text-th-text-alt">{d.toRole}</span>
                      <span className="text-th-text-muted ml-auto">{shortAgentId(d.toAgentId)}</span>
                    </div>
                    {d.task && (
                      <p className="text-th-text-muted mt-1 break-words">{d.task.length > 120 ? d.task.slice(0, 120) + '…' : d.task}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface AgentReportDetailModalProps {
  report: AgentReport;
  onClose: () => void;
}

export function AgentReportDetailModal({ report, onClose }: AgentReportDetailModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{report.fromRole}</span>
            <span className="text-xs text-th-text-muted">→ Project Lead</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-th-text-muted">
              {new Date(report.timestamp).toLocaleTimeString()}
            </span>
            <button type="button" aria-label="Close report" onClick={onClose} className="text-th-text-muted hover:text-th-text">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <AgentReportBlock content={report.content} />
        </div>
      </div>
    </div>
  );
}
