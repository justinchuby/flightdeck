import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { RefreshCw, Filter, Trash2, Share2 } from 'lucide-react';
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
import { useTimelineStore } from '../../stores/timelineStore';
import { ReplayScrubber } from '../SessionReplay';
import { useSessionReplay } from '../../hooks/useSessionReplay';
import { useProjects } from '../../hooks/useProjects';
import { ProjectTabs } from '../ProjectTabs';
import { useOptionalProjectId } from '../../contexts/ProjectContext';
import { ShareDialog } from './ShareDialog';
import './timeline-a11y.css';

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
export function TimelinePage() {
  const contextProjectId = useOptionalProjectId();
  const storeAgents = useAppStore((s) => s.agents);
  const announcements = useAccessibilityAnnouncements();
  const prevErrorRef = useRef<string | null>(null);
  const prevCommCountRef = useRef<number>(0);

  // Persisted state from Zustand store (survives unmount)
  const selectedLead = useTimelineStore((s) => s.selectedLeadId);
  const setSelectedLead = useTimelineStore((s) => s.setSelectedLeadId);
  const liveMode = useTimelineStore((s) => s.liveMode);
  const setLiveMode = useTimelineStore((s) => s.setLiveMode);
  const showFilters = useTimelineStore((s) => s.showFilters);
  const setShowFilters = useTimelineStore((s) => s.setShowFilters);
  const roleFilter = useTimelineStore((s) => s.roleFilter);
  const setRoleFilter = useTimelineStore((s) => s.setRoleFilter);
  const commFilter = useTimelineStore((s) => s.commFilter);
  const setCommFilter = useTimelineStore((s) => s.setCommFilter);
  const hiddenStatuses = useTimelineStore((s) => s.hiddenStatuses);
  const setHiddenStatuses = useTimelineStore((s) => s.setHiddenStatuses);
  const setCachedData = useTimelineStore((s) => s.setCachedData);

  const getCachedData = useTimelineStore((s) => s.getCachedData);
  const clearCachedData = useTimelineStore((s) => s.clearCachedData);

  // Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Lead selection — live agents and historical projects
  const leads = storeAgents.filter(a => !a.parentId || a.role?.id === 'lead');

  // Fetch historical projects from shared hook
  const { projects } = useProjects();

  // Effective lead: context project (from ProjectLayout) > user selection > live agents > historical projects
  const effectiveLeadId = useMemo(() => {
    if (contextProjectId) return contextProjectId;
    if (selectedLead) return selectedLead;
    if (leads.length > 0) return leads[0].id;
    return projects.length > 0 ? projects[0].id : null;
  }, [contextProjectId, selectedLead, leads, projects]);

  // Auto-select first lead when agents arrive
  useEffect(() => {
    if (!selectedLead && leads.length > 0) {
      setSelectedLead(leads[0].id);
    }
  }, [leads, selectedLead, setSelectedLead]);

  // Auto-switch to replay mode when no live agents (historical data only)
  useEffect(() => {
    if (leads.length === 0 && projects.length > 0 && liveMode) {
      setLiveMode(false);
    }
  }, [leads.length, projects.length, liveMode, setLiveMode]);

  const { data: liveData, loading, error, refetch } = useTimelineData(effectiveLeadId);

  // Cache data in store for persistence across tab switches
  useEffect(() => {
    if (liveData && effectiveLeadId) {
      setCachedData(effectiveLeadId, liveData);
    }
  }, [liveData, effectiveLeadId, setCachedData]);

  // Use live data if available, fall back to cached data from store
  const data = liveData ?? (effectiveLeadId ? getCachedData(effectiveLeadId) : null);

  // Session replay — lift state so we can filter timeline data during playback
  // Always fetch keyframes so scrub bar works in both live and replay modes
  const replay = useSessionReplay(effectiveLeadId);

  // Clear cached data and refetch fresh from SSE
  const handleClearTimeline = useCallback(() => {
    if (effectiveLeadId) {
      clearCachedData(effectiveLeadId);
    }
    refetch();
  }, [effectiveLeadId, clearCachedData, refetch]);

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

  const filteredData = useMemo(() => {
    if (!data) return null;
    return applyFilters(data, roleFilter, commFilter, hiddenStatuses);
  }, [data, roleFilter, commFilter, hiddenStatuses]);

  // Clip timeline data to replay currentTime during playback
  const displayData = useMemo(() => {
    if (!filteredData) return null;
    // Only clip when replay is active (has keyframes loaded) and not in live mode
    if (!replay.keyframes.length || liveMode) return filteredData;
    // When paused at the end (currentTime >= duration), show everything
    if (!replay.playing && replay.currentTime >= replay.duration && replay.duration > 0) return filteredData;
    // Calculate the absolute cutoff time
    const sessionStart = new Date(replay.keyframes[0].timestamp).getTime();
    const cutoffMs = sessionStart + replay.currentTime;
    const cutoff = new Date(cutoffMs).toISOString();

    return {
      ...filteredData,
      agents: filteredData.agents
        .filter(a => new Date(a.createdAt).getTime() <= cutoffMs)
        .map(a => ({
          ...a,
          segments: a.segments
            .filter(s => new Date(s.startAt).getTime() <= cutoffMs)
            .map(s => ({
              ...s,
              // Clip segment end to cutoff if it extends beyond
              endAt: s.endAt && new Date(s.endAt).getTime() > cutoffMs ? cutoff : s.endAt,
            })),
        })),
      communications: filteredData.communications
        .filter(c => new Date(c.timestamp).getTime() <= cutoffMs),
      locks: filteredData.locks
        .filter(l => new Date(l.acquiredAt).getTime() <= cutoffMs),
      // Keep full time range — auto-panning in TimelineContainer handles the visible window
      timeRange: filteredData.timeRange,
    };
  }, [filteredData, replay.keyframes, replay.playing, replay.currentTime, replay.duration, liveMode]);

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
    <div className="space-y-0 h-full flex flex-col timeline-container" role="region" aria-label="Crew Collaboration Timeline">
      {/* Skip link for keyboard users */}
      <a href="#timeline-main" className="timeline-skip-link">
        Skip to timeline
      </a>

      {/* ARIA live regions for screen reader announcements */}
      <AccessibilityAnnouncer announcements={announcements} />

      {/* Project tabs — select project before viewing project-specific status */}
      {!contextProjectId && (
        <ProjectTabs
          activeId={effectiveLeadId}
          onChange={setSelectedLead}
          className="px-6 pt-2 border-b border-th-border-muted timeline-lead-selector"
        />
      )}

      {/* StatusBar — shows UNFILTERED crew health for selected project */}
      <StatusBar
        data={data}
        newEventCount={newEventCount}
        onErrorClick={handleStatusBarErrorClick}
      />

      <div className="p-6 space-y-4 flex-1 flex flex-col min-h-0">

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-text">Crew Collaboration Timeline</h1>
        <div className="flex items-center gap-2 timeline-toolbar" role="toolbar" aria-label="Timeline page controls">
          <button
            onClick={() => setShowFilters(!showFilters)}
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
            onClick={() => setLiveMode(!liveMode)}
            aria-label={liveMode ? 'Disable live updates' : 'Enable live updates'}
            aria-pressed={liveMode}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              liveMode
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/50 hover:bg-emerald-200 dark:hover:bg-emerald-900/60'
                : 'bg-th-bg-alt text-th-text-muted hover:bg-th-bg-muted hover:text-th-text-alt'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${liveMode ? 'bg-emerald-600 dark:bg-emerald-400 animate-pulse motion-reduce:animate-none' : 'bg-zinc-400 dark:bg-zinc-600'}`} aria-hidden="true" />
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
          <button
            onClick={handleClearTimeline}
            disabled={loading}
            aria-label="Clear cached timeline data and reload"
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-th-bg-alt text-th-text-alt hover:bg-th-bg-muted hover:text-th-text transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} aria-hidden="true" />
            Clear
          </button>
          {effectiveLeadId && (
            <button
              onClick={() => setShowShareDialog(true)}
              aria-label="Share session replay"
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-th-bg-alt text-th-text-alt hover:bg-th-bg-muted hover:text-th-text transition-colors"
            >
              <Share2 size={14} aria-hidden="true" />
              Share
            </button>
          )}
        </div>
      </div>

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

      {!effectiveLeadId && !loading && (
        <EmptyState
          title="No active projects"
          description="Start a project to see your AI agents collaborate in real time. The timeline will populate as agents are created and begin working."
        />
      )}

      {loading && !data && effectiveLeadId && (
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

      {displayData && displayData.agents.length === 0 && !loading && (
        <EmptyState />
      )}

      {displayData && displayData.agents.length > 0 && (
        <div className="flex-1 min-h-0 relative overflow-y-auto" id="timeline-main" ref={timelineMainRef}>
          <ErrorBanner
            errors={errorEntries}
            onScrollToError={handleScrollToError}
          />
          <TimelineContainer
            data={displayData}
            liveMode={liveMode}
            onLiveModeChange={setLiveMode}
            replayProgress={!liveMode && replay.duration > 0 ? replay.currentTime / replay.duration : undefined}
          />
        </div>
      )}

      </div>

      {/* Session Replay Scrubber — always visible, sticky bottom */}
      {effectiveLeadId && (
        <div className="shrink-0 border-t border-th-border-muted bg-th-bg px-4 py-2">
          <ReplayScrubber
            leadId={effectiveLeadId}
            replay={replay}
            liveMode={liveMode}
            onExitLive={() => setLiveMode(false)}
            onGoLive={() => setLiveMode(true)}
          />
        </div>
      )}

      {/* Share dialog */}
      {showShareDialog && effectiveLeadId && (
        <ShareDialog leadId={effectiveLeadId} onClose={() => setShowShareDialog(false)} />
      )}
    </div>
  );
}
