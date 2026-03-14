import { Search, X } from 'lucide-react';
import { type FilterState, hasActiveFilters, EMPTY_FILTERS } from './kanbanConstants';

// ── Filter Bar Component ────────────────────────────────────────────

export interface FilterBarProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  availableRoles: string[];
  availablePriorities: number[];
  availableAgents: string[];
}

export function FilterBar({ filters, onChange, availableRoles, availablePriorities, availableAgents: _availableAgents }: FilterBarProps) {
  const toggleSetItem = <T,>(set: Set<T>, item: T): Set<T> => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-th-border/50 overflow-x-auto" data-testid="filter-bar">
      {/* Search */}
      <div className="flex items-center gap-1 bg-th-bg-muted rounded px-2 py-1 min-w-[120px]">
        <Search size={11} className="text-th-text-muted flex-shrink-0" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="bg-transparent text-[11px] text-th-text outline-none w-full placeholder:text-th-text-muted"
          data-testid="filter-search"
        />
      </div>

      {/* Role chips */}
      {availableRoles.length > 1 && (
        <div className="flex items-center gap-1">
          {availableRoles.map(role => (
            <button
              key={role}
              onClick={() => onChange({ ...filters, roles: toggleSetItem(filters.roles, role) })}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filters.roles.has(role)
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                  : 'border-th-border text-th-text-muted hover:text-th-text hover:border-th-text-muted'
              }`}
              data-testid={`filter-role-${role}`}
            >
              {role}
            </button>
          ))}
        </div>
      )}

      {/* Priority chips */}
      {availablePriorities.filter(p => p > 0).length > 0 && (
        <div className="flex items-center gap-1">
          {availablePriorities.filter(p => p > 0).sort((a, b) => b - a).map(p => (
            <button
              key={p}
              onClick={() => onChange({ ...filters, priorities: toggleSetItem(filters.priorities, p) })}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filters.priorities.has(p)
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                  : 'border-th-border text-th-text-muted hover:text-th-text hover:border-th-text-muted'
              }`}
              data-testid={`filter-priority-${p}`}
            >
              P{p}
            </button>
          ))}
        </div>
      )}

      {/* Clear filters */}
      {hasActiveFilters(filters) && (
        <button
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="text-[10px] text-th-text-muted hover:text-th-text flex items-center gap-0.5"
          data-testid="filter-clear"
        >
          <X size={10} /> Clear
        </button>
      )}
    </div>
  );
}
