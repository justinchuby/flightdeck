import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Filter } from 'lucide-react';
import { useTimelineData } from './useTimelineData';
import type { TimelineData, CommType, TimelineStatus } from './useTimelineData';
import { TimelineContainer } from './TimelineContainer';
import { StatusBar } from './StatusBar';
import { ErrorBanner } from './ErrorBanner';
import type { ErrorEntry } from './ErrorBanner';
import { EmptyState } from './EmptyState';
import { useSinceLastVisit } from './useSinceLastVisit';
import { AccessibilityAnnouncer } from './AccessibilityAnnouncer';
import { useAccessibilityAnnouncements } from './useAccessibilityAnnouncements';
import { useAppStore } from '../../stores/appStore';
import './timeline-a11y.css';

interface Props {
  api: any;
  ws: any;
}

// ── Filter config ────────────────────────────────────────────────────

const ALL_ROLES = ['lead', 'architect', 'developer', 'code-reviewer', 'critical-reviewer', 'designer', 'secretary', 'qa-tester'] as const;
const ALL_COMM_TYPES: CommType[] = ['delegation', 'message', 'group_message', 'broadcast'];
const HIDDEN_STATUSES: TimelineStatus[] = ['completed', 'terminated'];

const ROLE_LABELS: Record<string, string> = {
  lead: 'Lead', architect: 'Architect', developer: 'Developer',
  'code-reviewer': 'Code Rev', 'critical-reviewer': 'Crit Rev',
  designer: 'Designer', secretary: 'Secretary', 'qa-tester': 'QA',
};
const COMM_LABELS: Record<CommType, string> = {
  delegation: 'Delegation', message: 'Message', group_message: 'Group', broadcast: 'Broadcast',
};

function ToggleChips<T extends string>({ label, items, selected, labels, onChange }: {
  label: string;
  items: readonly T[];
  selected: Set<T>;
  labels: Record<string, string>;
  onChange: (next: Set<T>) => void;
}) {
  const toggle = (item: T) => {
    const next = new Set(selected);
    if (next.has(item)) next.delete(item); else next.add(item);
    onChange(next);
  };

  return (
    <div className="space-y-1" role="group" aria-label={`${label} filter`}>
      <span className="text-[10px] uppercase tracking-wider text-th-text-muted font-medium" id={`filter-${label.toLowerCase()}`}>{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`filter-${label.toLowerCase()}`}>
        {items.map(item => (
          <button
            key={item}
            onClick={() => toggle(item)}
            aria-pressed={selected.has(item)}
            className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
              selected.has(item)
                ? 'bg-th-bg-muted border-th-border text-th-text-alt'
                : 'bg-transparent border-th-border text-th-text-muted hover:border-th-border-hover'
            }`}
          >
            {labels[item] ?? item}
          </button>
        ))}
      </div>
    </div>
  );
}

function applyFilters(
  data: TimelineData,
  roles: Set<string>,
  commTypes: Set<CommType>,
  hiddenStatuses: Set<TimelineStatus>,
): TimelineData {
  const visibleAgentIds = new Set(
    data.agents
      .filter(a => roles.has(a.role))
      .filter(a => {
        const lastSeg = a.segments[a.segments.length - 1];
        return !lastSeg || !hiddenStatuses.has(lastSeg.status);
      })
      .map(a => a.id),
  );

  return {
    ...data,
    agents: data.agents.filter(a => visibleAgentIds.has(a.id)),
    communications: data.communications.filter(
      c => commTypes.has(c.type) && visibleAgentIds.has(c.fromAgentId),
    ),
    locks: data.locks.filter(l => visibleAgentIds.has(l.agentId)),
  };
}

/** Timeline visualization page — shows agent activity over time using visx. */
export function TimelinePage({ api, ws }: Props) {
  const storeAgents = useAppStore((s) => s.agents);
  const announcements = useAccessibilityAnnouncements();
  const prevErrorRef = useRef<string | null>(null);
  const prevCommCountRef = useRef<number>(0);

  // Lead selection
  const leads = storeAgents.filter(a => !a.parentId || a.role?.id === 'lead');
  const [selectedLead, setSelectedLead] = useState<string | null>(null);
  // Auto-select first lead when agents arrive
  useEffect(() => {
    if (!selectedLead && leads.length > 0) {
      setSelectedLead(leads[0].id);
    }
  }, [leads, selectedLead]);
  const { data, loading, error, refetch } = useTimelineData(selectedLead);
  const [liveMode, setLiveMode] = useState(true);

  // Announce errors via assertive live region
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      announcements.announceError(error);
    }
    prevErrorRef.current = error;
  }, [error, announcements]);

  // Announce new events for screen readers
  useEffect(() => {
    if (!data) return;
    const count = data.communications.length;
    const newCount = count - prevCommCountRef.current;
    if (prevCommCountRef.current > 0 && newCount > 0) {
      const latest = data.communications[count - 1];
      announcements.announceNewEvents(newCount, latest?.type);
    }
    prevCommCountRef.current = count;
  }, [data, announcements]);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [roleFilter, setRoleFilter] = useState<Set<string>>(() => new Set(ALL_ROLES));
  const [commFilter, setCommFilter] = useState<Set<CommType>>(() => new Set(ALL_COMM_TYPES));
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<TimelineStatus>>(() => new Set());

  const filteredData = useMemo(() => {
    if (!data) return null;
    return applyFilters(data, roleFilter, commFilter, hiddenStatuses);
  }, [data, roleFilter, commFilter, hiddenStatuses]);

  const activeFilterCount =
    (ALL_ROLES.length - roleFilter.size) +
    (ALL_COMM_TYPES.length - commFilter.size) +
    hiddenStatuses.size;

  // ── Since-last-visit tracking ────────────────────────────────────────
  // Synthetic IDs (comm-/seg- prefix) — will migrate to server ULIDs when available
  const eventIds = useMemo(() => {
    if (!data) return [];
    const events: { id: string; time: string }[] = [];
    for (const comm of data.communications) {
      events.push({ id: `comm-${comm.fromAgentId}-${comm.timestamp}`, time: comm.timestamp });
    }
    for (const agent of data.agents) {
      for (const seg of agent.segments) {
        events.push({ id: `seg-${agent.id}-${seg.startAt}`, time: seg.startAt });
      }
    }
    events.sort((a, b) => a.time.localeCompare(b.time));
    return events.map(e => e.id);
  }, [data]);

  const { newEventCount, markAsSeen } = useSinceLastVisit(
    eventIds,
    selectedLead ?? 'default',
  );

  // Mark events as seen when user interacts with the timeline
  useEffect(() => {
    if (data && liveMode) markAsSeen();
  }, [data, liveMode, markAsSeen]);

  // ── Error entries for ErrorBanner ────────────────────────────────────
  const errorEntries: ErrorEntry[] = useMemo(() => {
    if (!data) return [];
    return data.agents
      .filter(a => {
        const lastSeg = a.segments[a.segments.length - 1];
        return lastSeg?.status === 'failed';
      })
      .map(a => ({
        id: a.id,
        agentLabel: `${a.role} (${a.shortId})`,
        message: a.segments[a.segments.length - 1]?.taskLabel || 'Agent failed',
      }));
  }, [data]);

  const timelineMainRef = useRef<HTMLDivElement>(null);

  const handleScrollToError = useCallback((errorId: string) => {
    // Target HTML scroll anchor first, fall back to SVG g element
    // (scrollIntoView on SVG <g> is inconsistent in Safari/Firefox)
    const anchor = timelineMainRef.current?.querySelector(`[data-agent-scroll-anchor="${errorId}"]`);
    const el = anchor ?? timelineMainRef.current?.querySelector(`[data-agent-id="${errorId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      timelineMainRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const handleStatusBarErrorClick = useCallback(() => {
    if (errorEntries.length > 0) {
      handleScrollToError(errorEntries[0].id);
    }
  }, [errorEntries, handleScrollToError]);

  return (
    <div className="space-y-0 h-full flex flex-col timeline-container" role="region" aria-label="Team Collaboration Timeline">
      {/* Skip link for keyboard users */}
      <a href="#timeline-main" className="timeline-skip-link">
        Skip to timeline
      </a>

      {/* ARIA live regions for screen reader announcements */}
      <AccessibilityAnnouncer announcements={announcements} />

      {/* StatusBar — always shows UNFILTERED crew health */}
      <StatusBar
        data={data}
        newEventCount={newEventCount}
        onErrorClick={handleStatusBarErrorClick}
      />

      <div className="p-6 space-y-4 flex-1 flex flex-col min-h-0">

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-text">Team Collaboration Timeline</h1>
        <div className="flex items-center gap-2 timeline-toolbar" role="toolbar" aria-label="Timeline page controls">
          <button
            onClick={() => setShowFilters(f => !f)}
            aria-label={`${showFilters ? 'Hide' : 'Show'} filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
            aria-expanded={showFilters}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'bg-indigo-900/40 border border-indigo-500/50 text-indigo-300'
                : 'bg-th-bg-alt text-th-text-alt hover:bg-th-bg-muted hover:text-th-text'
            }`}
          >
            <Filter size={14} />
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <button
            onClick={() => setLiveMode(prev => !prev)}
            aria-label={liveMode ? 'Disable live updates' : 'Enable live updates'}
            aria-pressed={liveMode}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              liveMode
                ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50 hover:bg-emerald-900/60'
                : 'bg-th-bg-alt text-th-text-muted hover:bg-th-bg-muted hover:text-th-text-alt'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${liveMode ? 'bg-emerald-400 animate-pulse motion-reduce:animate-none' : 'bg-zinc-600'}`} aria-hidden="true" />
            Live
          </button>
          <button
            onClick={refetch}
            disabled={loading}
            aria-label={loading ? 'Refreshing timeline data' : 'Refresh timeline data'}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-th-bg-alt text-th-text-alt hover:bg-th-bg-muted hover:text-th-text transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Lead / project selector */}
      {leads.length > 1 && (
        <nav className="flex items-center gap-1.5 overflow-x-auto timeline-lead-selector" role="tablist" aria-label="Project selection">
          {leads.map(lead => (
            <button
              key={lead.id}
              onClick={() => setSelectedLead(lead.id)}
              role="tab"
              aria-selected={selectedLead === lead.id}
              className={`px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                selectedLead === lead.id
                  ? 'bg-accent/20 text-accent font-medium'
                  : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted/50'
              }`}
            >
              {lead.projectName || lead.role?.name || lead.id.slice(0, 8)}
            </button>
          ))}
        </nav>
      )}

      {/* Filter toolbar */}
      {showFilters && (
        <div className="bg-th-bg rounded-lg border border-th-border-muted px-4 py-3 flex flex-wrap gap-6 items-start timeline-filters" role="region" aria-label="Timeline filters">
          <ToggleChips label="Roles" items={ALL_ROLES} selected={roleFilter} labels={ROLE_LABELS} onChange={setRoleFilter} />
          <ToggleChips label="Communication" items={ALL_COMM_TYPES} selected={commFilter} labels={COMM_LABELS} onChange={setCommFilter} />
          <div className="space-y-1" role="group" aria-label="Hide agents by status">
            <span className="text-[10px] uppercase tracking-wider text-th-text-muted font-medium" id="filter-hide-agents">Hide agents</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="filter-hide-agents">
              {HIDDEN_STATUSES.map(status => (
                <button
                  key={status}
                  onClick={() => {
                    const next = new Set(hiddenStatuses);
                    if (next.has(status)) next.delete(status); else next.add(status);
                    setHiddenStatuses(next);
                  }}
                  aria-pressed={hiddenStatuses.has(status)}
                  className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                    hiddenStatuses.has(status)
                      ? 'bg-th-bg-muted border-th-border text-th-text-alt'
                      : 'bg-transparent border-th-border text-th-text-muted hover:border-th-border-hover'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setRoleFilter(new Set(ALL_ROLES));
                setCommFilter(new Set(ALL_COMM_TYPES));
                setHiddenStatuses(new Set());
              }}
              className="text-[11px] text-th-text-muted hover:text-th-text-alt self-end pb-0.5"
            >
              Reset all
            </button>
          )}
        </div>
      )}

      {!selectedLead && !loading && (
        <EmptyState
          title="No active projects"
          description="Start a project to see your AI agents collaborate in real time. The timeline will populate as agents are created and begin working."
        />
      )}

      {loading && !data && selectedLead && (
        <div className="bg-th-bg rounded-lg border border-th-border-muted p-8 min-h-[400px] flex items-center justify-center" role="status" aria-label="Loading timeline data">
          <RefreshCw size={24} className="animate-spin motion-reduce:animate-none text-th-text-muted" aria-hidden="true" />
          <span className="sr-only">Loading timeline data…</span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 rounded-lg border border-red-800 p-4" role="alert">
          <p className="text-red-400 text-sm">Error: {error}</p>
        </div>
      )}

      {filteredData && filteredData.agents.length === 0 && !loading && (
        <EmptyState />
      )}

      {filteredData && filteredData.agents.length > 0 && (
        <div className="flex-1 min-h-0 relative" id="timeline-main" ref={timelineMainRef}>
          <ErrorBanner
            errors={errorEntries}
            onScrollToError={handleScrollToError}
          />
          <TimelineContainer data={filteredData} liveMode={liveMode} onLiveModeChange={setLiveMode} />
        </div>
      )}
      </div>
    </div>
  );
}
