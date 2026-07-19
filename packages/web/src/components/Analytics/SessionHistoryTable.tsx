import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SessionSummary } from './types';
import { shortAgentId } from '../../utils/agentLabel';
import { formatDateTime } from '../../utils/format';

interface SessionHistoryTableProps {
  sessions: SessionSummary[];
  onSelect?: (leadId: string) => void;
  selectedIds?: string[];
  onToggleCompare?: (leadId: string) => void;
}

type SortField = 'date' | 'tokens' | 'tasks' | 'agents';

export function SessionHistoryTable({
  sessions,
  onSelect,
  selectedIds = [],
  onToggleCompare,
}: SessionHistoryTableProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  const sorted = useMemo(() => {
    const arr = [...sessions];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(); break;
        case 'tokens': cmp = (a.totalInputTokens + a.totalOutputTokens) - (b.totalInputTokens + b.totalOutputTokens); break;
        case 'tasks': cmp = a.taskCount - b.taskCount; break;
        case 'agents': cmp = a.agentCount - b.agentCount; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [sessions, sortField, sortDir]);

  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  }

  function formatDuration(s: SessionSummary): string {
    if (!s.endedAt) return '—';
    const ms = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
    const mins = Math.round(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function formatDate(iso: string): string {
    return formatDateTime(iso);
  }

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="session-history-table">
      <h3 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide mb-3">Session History</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-th-text-muted border-b border-th-border">
              {onToggleCompare && <th className="pb-2 text-left w-8">☐</th>}
              <th className="pb-2 text-left">Session</th>
              <th className="pb-2 text-left cursor-pointer select-none" onClick={() => toggleSort('date')}>
                <span className="inline-flex items-center gap-0.5">Date <SortIcon field="date" /></span>
              </th>
              <th className="pb-2 text-left">Project</th>
              <th className="pb-2 text-left">Duration</th>
              <th className="pb-2 text-right cursor-pointer select-none" onClick={() => toggleSort('tokens')}>
                <span className="inline-flex items-center gap-0.5">Tokens <SortIcon field="tokens" /></span>
              </th>
              <th className="pb-2 text-right cursor-pointer select-none" onClick={() => toggleSort('tasks')}>
                <span className="inline-flex items-center gap-0.5">Tasks <SortIcon field="tasks" /></span>
              </th>
              <th className="pb-2 text-right cursor-pointer select-none" onClick={() => toggleSort('agents')}>
                <span className="inline-flex items-center gap-0.5">Agents <SortIcon field="agents" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((s) => (
              <tr
                key={s.leadId}
                className={`border-b border-th-border/40 hover:bg-th-bg-muted/30 cursor-pointer transition-colors ${
                  selectedIds.includes(s.leadId) ? 'bg-accent/5' : ''
                }`}
                onClick={() => onSelect?.(s.leadId)}
              >
                {onToggleCompare && (
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.leadId)}
                      onChange={() => onToggleCompare(s.leadId)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-th-border"
                    />
                  </td>
                )}
                <td
                  className="py-2 font-mono text-th-text-muted hover:text-th-text cursor-pointer"
                  title={`Session: ${s.leadId} — click to copy`}
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.leadId); }}
                >
                  {shortAgentId(s.leadId)}
                </td>
                <td className="py-2 text-th-text-alt">{formatDate(s.startedAt)}</td>
                <td className="py-2 text-th-text-muted truncate max-w-[120px]">{s.projectId ?? shortAgentId(s.leadId)}</td>
                <td className="py-2 text-th-text-muted">{formatDuration(s)}</td>
                <td className="py-2 text-right text-th-text-alt">{((s.totalInputTokens + s.totalOutputTokens) / 1000).toFixed(0)}k</td>
                <td className="py-2 text-right text-th-text-alt">{s.taskCount}</td>
                <td className="py-2 text-right text-th-text-alt">{s.agentCount}</td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={onToggleCompare ? 8 : 7} className="py-8 text-center text-th-text-muted">No sessions found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-th-text-muted">{sorted.length} sessions</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-[10px] px-2 py-0.5 rounded border border-th-border text-th-text-muted disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-[10px] text-th-text-muted px-1">
              {page + 1}/{totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-[10px] px-2 py-0.5 rounded border border-th-border text-th-text-muted disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
