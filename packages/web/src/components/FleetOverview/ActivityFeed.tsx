import { useState } from 'react';
import type { AgentInfo } from '../../types';
import type { ActivityEntry } from './FleetOverview';
import { shortAgentId } from '../../utils/agentLabel';

interface Props {
  activity: ActivityEntry[];
  agents: AgentInfo[];
}

const ACTION_ICONS: Record<string, string> = {
  file_edit: '✏️',
  file_read: '📖',
  file_create: '📄',
  lock_acquire: '🔒',
  lock_release: '🔓',
  spawn: '🚀',
  task_start: '▶️',
  task_complete: '✅',
  error: '❌',
  command: '💻',
};

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function ActivityFeed({ activity, agents }: Props) {
  const [selected, setSelected] = useState<ActivityEntry | null>(null);

  const getAgentLabel = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return `${agent.role.icon} ${agent.role.name} (${shortAgentId(agent.id)})`;
    return shortAgentId(agentId);
  };

  const getAgent = (agentId: string) => agents.find((a) => a.id === agentId);

  const formatDetails = (details: string | Record<string, unknown>) => {
    if (typeof details === 'string') return details;
    return JSON.stringify(details, null, 2);
  };

  return (
    <>
      <div className="border border-th-border rounded-lg bg-surface-raised flex flex-col">
        <div className="px-3 py-2 border-b border-th-border">
          <h3 className="text-xs font-medium text-th-text-alt uppercase tracking-wider">
            Live Activity
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[320px] divide-y divide-th-border/50">
          {activity.length === 0 ? (
            <div className="p-4 text-center text-th-text-muted text-xs">No recent activity</div>
          ) : (
            activity.map((entry) => (
              <div
                key={entry.id}
                className="px-3 py-2 hover:bg-surface/50 transition-colors cursor-pointer"
                onClick={() => setSelected(entry)}
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm mt-0.5">
                    {ACTION_ICONS[entry.actionType] ?? '📌'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-th-text-alt font-medium">
                        {getAgentLabel(entry.agentId)}
                      </span>
                      <span className="text-[10px] text-th-text-muted">{entry.actionType.replace(/_/g, ' ')}</span>
                    </div>
                    {entry.filePath && (
                      <div className="text-[11px] text-th-text-muted font-mono truncate" title={entry.filePath}>
                        {entry.filePath}
                      </div>
                    )}
                    {entry.details && (
                      <div className="text-[10px] text-th-text-muted truncate" title={typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}>
                        {typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-th-text-muted whitespace-nowrap shrink-0">
                    {timeAgo(entry.timestamp)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Activity detail popup */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-lg w-full max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2">
                <span className="text-lg">{ACTION_ICONS[selected.actionType] ?? '📌'}</span>
                <span className="text-sm font-semibold text-th-text capitalize">
                  {selected.actionType.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(selected.timestamp).toLocaleString()}
                </span>
                <button onClick={() => setSelected(null)} className="text-th-text-muted hover:text-th-text text-lg leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {/* Agent info */}
              <div>
                <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Agent</span>
                {(() => {
                  const agent = getAgent(selected.agentId);
                  return agent ? (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg">{agent.role.icon}</span>
                      <div>
                        <p className="text-sm font-mono text-th-text-alt">{agent.role.name}</p>
                        <p className="text-[10px] font-mono text-th-text-muted">{shortAgentId(agent.id)} · {agent.status}{agent.provider ? ` · ${agent.provider}` : ''} · {agent.model || 'default'}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-mono text-th-text-alt mt-1">{shortAgentId(selected.agentId)}</p>
                  );
                })()}
              </div>

              {/* File path */}
              {selected.filePath && (
                <div>
                  <span className="text-[10px] text-th-text-muted uppercase tracking-wider">File</span>
                  <p className="text-sm font-mono text-blue-400 mt-0.5 break-all">{selected.filePath}</p>
                </div>
              )}

              {/* Details */}
              {selected.details && (
                <div>
                  <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Details</span>
                  <pre className="text-sm font-mono text-th-text-alt mt-0.5 whitespace-pre-wrap break-words bg-th-bg/50 rounded p-2 max-h-60 overflow-y-auto">
                    {formatDetails(selected.details)}
                  </pre>
                </div>
              )}

              {/* Timestamp */}
              <div>
                <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Time</span>
                <p className="text-xs font-mono text-th-text-muted mt-0.5">{new Date(selected.timestamp).toLocaleString()} ({timeAgo(selected.timestamp)})</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
