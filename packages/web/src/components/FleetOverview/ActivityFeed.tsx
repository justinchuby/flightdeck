import type { AgentInfo } from '../../types';
import type { ActivityEntry } from './FleetOverview';

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
  const getAgentLabel = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return `${agent.role.icon} ${agent.role.name}`;
    return agentId.slice(0, 8);
  };

  return (
    <div className="border border-gray-700 rounded-lg bg-surface-raised flex flex-col">
      <div className="px-3 py-2 border-b border-gray-700">
        <h3 className="text-xs font-medium text-gray-300 uppercase tracking-wider">
          Live Activity
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[320px] divide-y divide-gray-700/50">
        {activity.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-xs">No recent activity</div>
        ) : (
          activity.map((entry) => (
            <div key={entry.id} className="px-3 py-2 hover:bg-surface/50 transition-colors">
              <div className="flex items-start gap-2">
                <span className="text-sm mt-0.5">
                  {ACTION_ICONS[entry.actionType] ?? '📌'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-300 font-medium">
                      {getAgentLabel(entry.agentId)}
                    </span>
                    <span className="text-[10px] text-gray-500">{entry.actionType.replace(/_/g, ' ')}</span>
                  </div>
                  {entry.filePath && (
                    <div className="text-[11px] text-gray-400 font-mono truncate" title={entry.filePath}>
                      {entry.filePath}
                    </div>
                  )}
                  {entry.details && (
                    <div className="text-[10px] text-gray-500 truncate" title={entry.details}>
                      {entry.details}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0">
                  {timeAgo(entry.timestamp)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
