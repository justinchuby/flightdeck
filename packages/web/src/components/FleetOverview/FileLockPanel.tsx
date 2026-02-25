import type { AgentInfo } from '../../types';
import type { FileLock } from './FleetOverview';
import { Lock } from 'lucide-react';

interface Props {
  locks: FileLock[];
  agents: AgentInfo[];
}

function timeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export function FileLockPanel({ locks, agents }: Props) {
  const getAgentLabel = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return `${agent.role.icon} ${agent.role.name}`;
    return agentId.slice(0, 8);
  };

  return (
    <div className="border border-gray-700 rounded-lg bg-surface-raised flex flex-col">
      <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2">
        <Lock size={12} className="text-purple-400" />
        <h3 className="text-xs font-medium text-gray-300 uppercase tracking-wider">
          File Locks ({locks.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[320px] divide-y divide-gray-700/50">
        {locks.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-xs">No active file locks</div>
        ) : (
          locks.map((lock) => (
            <div key={`${lock.agentId}-${lock.filePath}`} className="px-3 py-2 hover:bg-surface/50 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-200 font-mono truncate" title={lock.filePath}>
                    {lock.filePath}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-gray-400">
                      {getAgentLabel(lock.agentId)}
                    </span>
                    {lock.reason && (
                      <>
                        <span className="text-[10px] text-gray-600">·</span>
                        <span className="text-[10px] text-gray-500 truncate" title={lock.reason}>
                          {lock.reason}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 whitespace-nowrap shrink-0">
                  TTL: {timeRemaining(lock.expiresAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
