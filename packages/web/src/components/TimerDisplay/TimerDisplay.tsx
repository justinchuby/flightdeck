import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTimerStore, selectActiveTimerCount } from '../../stores/timerStore';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';
import { TimerCreateForm } from './TimerCreateForm';
import type { TimerInfo } from '../../types';

type TimerFilter = 'active' | 'fired' | 'all';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Resolve agent role name from appStore by agentId */
function useAgentRole(agentId: string): string {
  const agents = useAppStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  return agent?.role?.name ?? 'agent';
}

function TimerCard({ timer, onCancel }: { timer: TimerInfo; onCancel: (id: string) => void }) {
  const roleName = useAgentRole(timer.agentId);
  const isPending = timer.status === 'pending';
  const isFired = timer.status === 'fired';
  const recentlyFiredIds = useTimerStore((s) => s.recentlyFiredIds);
  const isRecentlyFired = recentlyFiredIds.includes(timer.id);

  return (
    <div
      data-testid={`timer-${timer.id}`}
      className={`rounded border px-2 py-1.5 transition-all duration-300 ${
        isRecentlyFired
          ? 'border-green-500/50 bg-green-500/10'
          : isFired
            ? 'border-th-border/50 bg-th-bg-muted/30 opacity-60'
            : 'border-th-border bg-th-bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-th-text-alt truncate">{timer.label}</span>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span
            className={`text-[10px] ${
              isRecentlyFired
                ? 'text-green-400 font-semibold'
                : isFired
                  ? 'text-green-400'
                  : timer.repeat
                    ? 'text-purple-400'
                    : 'text-yellow-400'
            }`}
          >
            {isRecentlyFired
              ? '✓ fired!'
              : isFired
                ? '✓ fired'
                : timer.repeat
                  ? `⟳ ${formatRemaining(timer.remainingMs)}`
                  : formatRemaining(timer.remainingMs)}
          </span>
          {isPending && (
            <button
              onClick={() => onCancel(timer.id)}
              className="text-[10px] text-red-400 hover:text-red-300 px-1 py-0.5 rounded hover:bg-red-500/10"
              title="Cancel timer"
              aria-label={`Cancel timer ${timer.label}`}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-th-text-muted">
        <span title={timer.agentId}>
          {roleName} ({shortId(timer.agentId)})
        </span>
        {timer.repeat && isPending && <span>every {timer.delaySeconds}s</span>}
      </div>
      {timer.message && (
        <div className="mt-0.5 text-th-text-muted truncate" title={timer.message}>
          💬 {timer.message}
        </div>
      )}
    </div>
  );
}

export function TimerDisplay({ projectAgentIds }: { projectAgentIds?: Set<string> }) {
  const allTimers = useTimerStore((s) => s.timers);
  const setTimers = useTimerStore((s) => s.setTimers);
  const removeTimer = useTimerStore((s) => s.removeTimer);
  const [filter, setFilter] = useState<TimerFilter>('active');
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Filter timers by project agents when a project filter is provided
  const timers = useMemo(() => {
    if (!projectAgentIds || projectAgentIds.size === 0) return allTimers;
    return allTimers.filter((t) => projectAgentIds.has(t.agentId));
  }, [allTimers, projectAgentIds]);

  // Initial fetch — WS events keep it updated after this
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<TimerInfo[]>('/timers');
        if (!cancelled) {
          setTimers(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to fetch timers');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [setTimers]);

  // Tick countdowns every second
  useEffect(() => {
    const interval = setInterval(() => {
      useTimerStore.getState().setTimers(
        useTimerStore.getState().timers.map((t) =>
          t.status !== 'pending' ? t : { ...t, remainingMs: Math.max(0, t.fireAt - Date.now()) },
        ),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCancel = useCallback(
    async (timerId: string) => {
      // Optimistic removal — server returns 200/404/409, all safe after local removal
      removeTimer(timerId);
      try {
        await apiFetch(`/timers/${timerId}`, { method: 'DELETE' });
      } catch {
        // 404 (not found) or 409 (already fired/cancelled) are fine — timer already removed locally
      }
    },
    [removeTimer],
  );

  const filtered = useMemo(() => {
    if (filter === 'active') return timers.filter((t) => t.status === 'pending');
    if (filter === 'fired') return timers.filter((t) => t.status === 'fired');
    return timers;
  }, [timers, filter]);

  const activeCount = timers.filter((t) => t.status === 'pending').length;
  const firedCount = timers.filter((t) => t.status === 'fired').length;

  if (error) {
    return <div className="p-3 text-xs text-red-400">Error: {error}</div>;
  }

  return (
    <div className="p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[11px] font-semibold text-th-text-alt uppercase tracking-wide">
            Timers
          </h3>
          <button
            onClick={() => setShowCreateForm((s) => !s)}
            className="text-[11px] text-blue-400 hover:text-blue-300 px-1 rounded hover:bg-blue-500/10"
            title={showCreateForm ? 'Close form' : 'Create timer'}
            data-testid="timer-create-toggle"
          >
            {showCreateForm ? '−' : '+'}
          </button>
        </div>
        <div className="flex gap-1">
          {(['active', 'fired', 'all'] as TimerFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                filter === f
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-th-text-muted hover:text-th-text-alt'
              }`}
            >
              {f === 'active'
                ? `Active (${activeCount})`
                : f === 'fired'
                  ? `Fired (${firedCount})`
                  : `All (${timers.length})`}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-th-text-muted text-center py-4">
          {filter === 'active'
            ? 'No active timers'
            : filter === 'fired'
              ? 'No fired timers'
              : 'No timers'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((timer) => (
            <TimerCard key={timer.id} timer={timer} onCancel={handleCancel} />
          ))}
        </div>
      )}

      {showCreateForm && <TimerCreateForm onClose={() => setShowCreateForm(false)} />}
    </div>
  );
}
