import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '../timelineStore';
import type { TimelineData, CommType, TimelineStatus } from '../../components/Timeline/useTimelineData';

function resetStore() {
  useTimelineStore.getState().reset();
}

function makeTimelineData(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    agents: [],
    communications: [],
    locks: [],
    timeRange: { start: '2026-03-01T10:00:00Z', end: '2026-03-01T12:00:00Z' },
    ...overrides,
  };
}

describe('timelineStore', () => {
  beforeEach(resetStore);

  // ── Selection ────────────────────────────────────────────────────

  it('initializes with null selectedLeadId and liveMode true', () => {
    const s = useTimelineStore.getState();
    expect(s.selectedLeadId).toBeNull();
    expect(s.liveMode).toBe(true);
  });

  it('persists selectedLeadId across reads', () => {
    useTimelineStore.getState().setSelectedLeadId('lead-1');
    expect(useTimelineStore.getState().selectedLeadId).toBe('lead-1');
  });

  it('persists liveMode across reads', () => {
    useTimelineStore.getState().setLiveMode(false);
    expect(useTimelineStore.getState().liveMode).toBe(false);
  });

  // ── Filters ──────────────────────────────────────────────────────

  it('initializes with all roles enabled', () => {
    const { roleFilter } = useTimelineStore.getState();
    expect(roleFilter.has('developer')).toBe(true);
    expect(roleFilter.has('lead')).toBe(true);
    expect(roleFilter.size).toBe(8);
  });

  it('persists role filter changes', () => {
    const newFilter = new Set(['developer', 'architect']);
    useTimelineStore.getState().setRoleFilter(newFilter);
    const { roleFilter } = useTimelineStore.getState();
    expect(roleFilter.size).toBe(2);
    expect(roleFilter.has('developer')).toBe(true);
    expect(roleFilter.has('lead')).toBe(false);
  });

  it('persists comm filter changes', () => {
    const newFilter: Set<CommType> = new Set(['message']);
    useTimelineStore.getState().setCommFilter(newFilter);
    expect(useTimelineStore.getState().commFilter.size).toBe(1);
  });

  it('persists hidden statuses', () => {
    const hidden: Set<TimelineStatus> = new Set(['completed', 'terminated']);
    useTimelineStore.getState().setHiddenStatuses(hidden);
    const { hiddenStatuses } = useTimelineStore.getState();
    expect(hiddenStatuses.has('completed')).toBe(true);
    expect(hiddenStatuses.has('terminated')).toBe(true);
    expect(hiddenStatuses.size).toBe(2);
  });

  it('persists showFilters toggle', () => {
    expect(useTimelineStore.getState().showFilters).toBe(false);
    useTimelineStore.getState().setShowFilters(true);
    expect(useTimelineStore.getState().showFilters).toBe(true);
  });

  // ── Expanded agents (per lead) ───────────────────────────────────

  it('returns empty set for unknown lead', () => {
    const expanded = useTimelineStore.getState().getExpandedAgents('unknown');
    expect(expanded.size).toBe(0);
  });

  it('toggles agent expansion per lead', () => {
    useTimelineStore.getState().toggleExpandedAgent('lead-1', 'agent-a');
    expect(useTimelineStore.getState().getExpandedAgents('lead-1').has('agent-a')).toBe(true);

    useTimelineStore.getState().toggleExpandedAgent('lead-1', 'agent-a');
    expect(useTimelineStore.getState().getExpandedAgents('lead-1').has('agent-a')).toBe(false);
  });

  it('keeps expanded agents separate per lead', () => {
    useTimelineStore.getState().toggleExpandedAgent('lead-1', 'agent-a');
    useTimelineStore.getState().toggleExpandedAgent('lead-2', 'agent-b');

    expect(useTimelineStore.getState().getExpandedAgents('lead-1').has('agent-a')).toBe(true);
    expect(useTimelineStore.getState().getExpandedAgents('lead-1').has('agent-b')).toBe(false);
    expect(useTimelineStore.getState().getExpandedAgents('lead-2').has('agent-b')).toBe(true);
  });

  // ── Sort direction ───────────────────────────────────────────────

  it('defaults to oldest-first sort', () => {
    expect(useTimelineStore.getState().sortDirection).toBe('oldest-first');
  });

  it('persists sort direction changes', () => {
    useTimelineStore.getState().setSortDirection('newest-first');
    expect(useTimelineStore.getState().sortDirection).toBe('newest-first');
  });

  // ── Cached data ──────────────────────────────────────────────────

  it('returns null for uncached lead data', () => {
    expect(useTimelineStore.getState().getCachedData('unknown')).toBeNull();
  });

  it('caches and retrieves timeline data per lead', () => {
    const data = makeTimelineData({ agents: [{ id: 'a1', shortId: 'a1', role: 'dev', createdAt: '2026-03-01T10:00:00Z', segments: [] }] });
    useTimelineStore.getState().setCachedData('lead-1', data);
    const cached = useTimelineStore.getState().getCachedData('lead-1');
    expect(cached).not.toBeNull();
    expect(cached!.agents).toHaveLength(1);
    expect(cached!.agents[0].id).toBe('a1');
  });

  it('caches data independently per lead', () => {
    const data1 = makeTimelineData({ agents: [{ id: 'a1', shortId: 'a1', role: 'dev', createdAt: '2026-03-01T10:00:00Z', segments: [] }] });
    const data2 = makeTimelineData({ agents: [{ id: 'b1', shortId: 'b1', role: 'arch', createdAt: '2026-03-01T10:00:00Z', segments: [] }] });
    useTimelineStore.getState().setCachedData('lead-1', data1);
    useTimelineStore.getState().setCachedData('lead-2', data2);
    expect(useTimelineStore.getState().getCachedData('lead-1')!.agents[0].id).toBe('a1');
    expect(useTimelineStore.getState().getCachedData('lead-2')!.agents[0].id).toBe('b1');
  });

  it('clearCachedData removes data for a specific lead', () => {
    const data1 = makeTimelineData({ agents: [{ id: 'a1', shortId: 'a1', role: 'dev', createdAt: '2026-03-01T10:00:00Z', segments: [] }] });
    const data2 = makeTimelineData({ agents: [{ id: 'b1', shortId: 'b1', role: 'arch', createdAt: '2026-03-01T10:00:00Z', segments: [] }] });
    useTimelineStore.getState().setCachedData('lead-1', data1);
    useTimelineStore.getState().setCachedData('lead-2', data2);

    useTimelineStore.getState().clearCachedData('lead-1');

    expect(useTimelineStore.getState().getCachedData('lead-1')).toBeNull();
    expect(useTimelineStore.getState().getCachedData('lead-2')!.agents[0].id).toBe('b1');
  });

  it('clearCachedData is a no-op for unknown lead', () => {
    const data = makeTimelineData();
    useTimelineStore.getState().setCachedData('lead-1', data);

    useTimelineStore.getState().clearCachedData('unknown');

    expect(useTimelineStore.getState().getCachedData('lead-1')).not.toBeNull();
  });

  // ── Reset ────────────────────────────────────────────────────────

  it('reset clears all state to defaults', () => {
    useTimelineStore.getState().setSelectedLeadId('lead-1');
    useTimelineStore.getState().setLiveMode(false);
    useTimelineStore.getState().setShowFilters(true);
    useTimelineStore.getState().setSortDirection('newest-first');
    useTimelineStore.getState().setCachedData('lead-1', makeTimelineData());
    useTimelineStore.getState().toggleExpandedAgent('lead-1', 'agent-a');

    useTimelineStore.getState().reset();

    const s = useTimelineStore.getState();
    expect(s.selectedLeadId).toBeNull();
    expect(s.liveMode).toBe(true);
    expect(s.showFilters).toBe(false);
    expect(s.sortDirection).toBe('oldest-first');
    expect(s.getCachedData('lead-1')).toBeNull();
    expect(s.getExpandedAgents('lead-1').size).toBe(0);
  });
});
