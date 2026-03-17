import { Users, Search, RefreshCw } from 'lucide-react';
import type { RosterStatus } from './types';

interface RosterFilterBarProps {
  crewCount: number;
  agentCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: RosterStatus | 'all';
  onStatusFilterChange: (value: RosterStatus | 'all') => void;
  onRefresh: () => void;
}

export function RosterFilterBar({
  crewCount,
  agentCount,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onRefresh,
}: RosterFilterBarProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">Crew Roster</h1>
          <span className="text-sm text-th-text-muted">
            {crewCount} crew{crewCount !== 1 ? 's' : ''} · {agentCount} agent{agentCount !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mt-4 shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-alt" />
          <input
            type="text"
            placeholder="Search crews, agents, tasks..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'idle', 'running', 'terminated', 'failed'] as const).map(s => (
            <button
              key={s}
              onClick={() => onStatusFilterChange(s)}
              className={`px-3 py-1.5 text-xs rounded capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-th-accent/20 text-th-accent border border-th-accent/30'
                  : 'bg-th-bg-alt text-th-text-alt border border-th-border hover:bg-th-border'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
