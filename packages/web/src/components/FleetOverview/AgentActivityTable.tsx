import { useAppStore } from '../../stores/appStore';
import type { AgentInfo, Task } from '../../types';
import type { FileLock } from './FleetOverview';
import { Square, RefreshCw, Terminal } from 'lucide-react';

function shortModelName(model?: string): string {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('opus')) return `Opus ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('sonnet')) return `Sonnet ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('haiku')) return `Haiku ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('gemini')) return `Gemini`;
  if (m.includes('gpt')) return m.replace('gpt-', 'GPT-').replace('-codex', ' Codex');
  return model;
}

interface Props {
  agents: AgentInfo[];
  tasks: Task[];
  locks: FileLock[];
  api: any;
  ws: any;
}

const STATUS_DOT: Record<string, string> = {
  creating: 'bg-yellow-400',
  running: 'bg-green-400 animate-pulse',
  idle: 'bg-blue-400',
  completed: 'bg-gray-400',
  failed: 'bg-red-400',
};

function elapsed(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function getCurrentActivity(agent: AgentInfo): { text: string; detail?: string } {
  // Active tool call
  if (agent.toolCalls?.length) {
    const active = agent.toolCalls.filter(
      (tc) => tc.status === 'in_progress' || tc.status === 'pending',
    );
    if (active.length > 0) {
      const latest = active[active.length - 1];
      return { text: `🔧 ${latest.title}`, detail: latest.kind };
    }
    const last = agent.toolCalls[agent.toolCalls.length - 1];
    return { text: `✅ ${last.title}`, detail: 'completed' };
  }

  // Plan progress
  if (agent.plan?.length) {
    const inProgress = agent.plan.find((p) => p.status === 'in_progress');
    if (inProgress) {
      return { text: `📋 ${inProgress.content}` };
    }
    const pending = agent.plan.find((p) => p.status === 'pending');
    if (pending) {
      return { text: `⏳ ${pending.content}` };
    }
    return { text: '📋 Plan complete' };
  }

  // Output preview fallback
  if (agent.outputPreview) {
    const lastLine = agent.outputPreview.trim().split('\n').pop() ?? '';
    return { text: lastLine.slice(0, 80) || 'Working...' };
  }

  if (agent.status === 'creating') return { text: 'Starting up...' };
  if (agent.status === 'completed') return { text: 'Finished' };
  if (agent.status === 'failed') return { text: 'Crashed' };
  return { text: 'Idle' };
}

export function AgentActivityTable({ agents, tasks, locks, api }: Props) {
  const { setSelectedAgent } = useAppStore();

  if (agents.length === 0) {
    return (
      <div className="border border-gray-700 rounded-lg bg-surface-raised p-8 text-center text-gray-500">
        <p>No agents to display</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-700 rounded-lg bg-surface-raised overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2">Agent</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2 hidden md:table-cell">Task</th>
            <th className="text-left px-3 py-2">Current Activity</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell">Progress</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell">Locks</th>
            <th className="text-left px-3 py-2 hidden sm:table-cell">Uptime</th>
            <th className="text-right px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const activity = getCurrentActivity(agent);
            const agentLocks = locks.filter((l) => l.agentId === agent.id);
            const agentTask = agent.taskId
              ? tasks.find((t) => t.id === agent.taskId)
              : undefined;
            const planTotal = agent.plan?.length ?? 0;
            const planDone = agent.plan?.filter((p) => p.status === 'completed').length ?? 0;

            return (
              <tr
                key={agent.id}
                className="border-b border-gray-700/50 hover:bg-surface/50 cursor-pointer transition-colors"
                onClick={() => setSelectedAgent(agent.id)}
              >
                {/* Agent identity */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{agent.role.icon}</span>
                    <div>
                      <div className="font-medium text-gray-200 text-xs">{agent.role.name}</div>
                      <div className="text-[10px] text-gray-500 font-mono flex items-center gap-1">
                        {agent.id.slice(0, 8)}
                        {(agent.model || agent.role.model) && (
                          <span className="text-gray-600">· {shortModelName(agent.model || agent.role.model)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Status */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-gray-400'}`} />
                    <span className="text-xs text-gray-300 capitalize">{agent.status}</span>
                    <span
                      className={`text-[10px] px-1 py-0.5 rounded ${
                        agent.mode === 'acp'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {agent.mode === 'acp' ? 'ACP' : 'PTY'}
                    </span>
                  </div>
                </td>

                {/* Task */}
                <td className="px-3 py-2.5 hidden md:table-cell">
                  {agentTask ? (
                    <div className="max-w-[180px]">
                      <div className="text-xs text-gray-300 truncate" title={agentTask.title}>
                        {agentTask.title}
                      </div>
                      <div className="text-[10px] text-gray-500 capitalize">{agentTask.status}</div>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </td>

                {/* Current Activity */}
                <td className="px-3 py-2.5">
                  <div className="max-w-[250px]">
                    <div className="text-xs text-gray-300 truncate" title={activity.text}>
                      {activity.text}
                    </div>
                    {activity.detail && (
                      <div className="text-[10px] text-gray-500">{activity.detail}</div>
                    )}
                  </div>
                </td>

                {/* Progress */}
                <td className="px-3 py-2.5 hidden lg:table-cell">
                  {planTotal > 0 ? (
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${(planDone / planTotal) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">
                        {planDone}/{planTotal}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </td>

                {/* Locks */}
                <td className="px-3 py-2.5 hidden lg:table-cell">
                  {agentLocks.length > 0 ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-purple-400">🔒 {agentLocks.length}</span>
                      <span
                        className="text-[10px] text-gray-500 truncate max-w-[100px]"
                        title={agentLocks.map((l) => l.filePath).join(', ')}
                      >
                        {agentLocks[0].filePath.split('/').pop()}
                        {agentLocks.length > 1 && ` +${agentLocks.length - 1}`}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </td>

                {/* Uptime */}
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  <span className="text-xs text-gray-400 font-mono">{elapsed(agent.createdAt)}</span>
                </td>

                {/* Actions */}
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAgent(agent.id);
                      }}
                      className="p-1 text-gray-400 hover:text-accent"
                      title="Open terminal"
                    >
                      <Terminal size={14} />
                    </button>
                    {(agent.status === 'completed' || agent.status === 'failed') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          api.restartAgent(agent.id);
                        }}
                        className="p-1 text-gray-400 hover:text-yellow-400"
                        title="Restart agent"
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    {agent.status === 'running' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          api.killAgent(agent.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-400"
                        title="Stop agent"
                      >
                        <Square size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
