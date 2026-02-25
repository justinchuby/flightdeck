import type { AgentInfo, Task } from '../../types';
import type { FileLock } from './FleetOverview';
import { Users, Zap, CheckCircle, AlertTriangle, ListTodo, Lock } from 'lucide-react';

interface Props {
  agents: AgentInfo[];
  tasks: Task[];
  locks: FileLock[];
}

export function FleetStats({ agents, tasks, locks }: Props) {
  const running = agents.filter((a) => a.status === 'running' || a.status === 'creating').length;
  const completed = agents.filter((a) => a.status === 'completed').length;
  const failed = agents.filter((a) => a.status === 'failed').length;
  const tasksQueued = tasks.filter((t) => t.status === 'queued').length;
  const tasksActive = tasks.filter((t) => t.status === 'in_progress' || t.status === 'assigned').length;

  const stats = [
    { label: 'Total Agents', value: agents.length, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Active', value: running, icon: Zap, color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: 'Completed', value: completed, icon: CheckCircle, color: 'text-gray-400', bg: 'bg-gray-500/10' },
    { label: 'Failed', value: failed, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'Tasks Queued', value: tasksQueued, icon: ListTodo, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
    { label: 'File Locks', value: locks.length, icon: Lock, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`${s.bg} border border-gray-700/50 rounded-lg p-3 flex items-center gap-3`}
        >
          <s.icon size={18} className={s.color} />
          <div>
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
