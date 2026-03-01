import { create } from 'zustand';
import type { TimelineData, CommType, TimelineStatus } from '../components/Timeline/useTimelineData';

// ── Types ────────────────────────────────────────────────────────────

export type SortDirection = 'newest-first' | 'oldest-first';

const ALL_ROLES = ['lead', 'architect', 'developer', 'code-reviewer', 'critical-reviewer', 'designer', 'secretary', 'qa-tester'];
const ALL_COMM_TYPES: CommType[] = ['delegation', 'message', 'group_message', 'broadcast'];

// Stable empty set — avoids new Set() on every selector call (CR-10)
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

const MAX_CACHED_LEADS = 10;

// ── State interface ──────────────────────────────────────────────────

interface TimelineState {
  // Lead/project selection
  selectedLeadId: string | null;
  liveMode: boolean;

  // Filter state
  showFilters: boolean;
  roleFilter: Set<string>;
  commFilter: Set<CommType>;
  hiddenStatuses: Set<TimelineStatus>;

  // View state (per lead)
  expandedAgents: Record<string, Set<string>>;
  sortDirection: SortDirection;

  // Cached timeline data (per lead) — survives unmount
  cachedData: Record<string, TimelineData>;

  // Actions
  setSelectedLeadId: (id: string | null) => void;
  setLiveMode: (live: boolean) => void;
  setShowFilters: (show: boolean) => void;
  setRoleFilter: (filter: Set<string>) => void;
  setCommFilter: (filter: Set<CommType>) => void;
  setHiddenStatuses: (statuses: Set<TimelineStatus>) => void;
  toggleExpandedAgent: (leadId: string, agentId: string) => void;
  expandMultipleAgents: (leadId: string, agentIds: string[]) => void;
  setExpandedAgents: (leadId: string, agentIds: Set<string>) => void;
  getExpandedAgents: (leadId: string) => ReadonlySet<string>;
  setSortDirection: (dir: SortDirection) => void;
  setCachedData: (leadId: string, data: TimelineData) => void;
  getCachedData: (leadId: string) => TimelineData | null;
  clearCachedData: (leadId: string) => void;
  reset: () => void;
}

// ── Store ────────────────────────────────────────────────────────────

export const useTimelineStore = create<TimelineState>((set, get) => ({
  selectedLeadId: null,
  liveMode: true,

  showFilters: false,
  roleFilter: new Set(ALL_ROLES),
  commFilter: new Set(ALL_COMM_TYPES),
  hiddenStatuses: new Set(),

  expandedAgents: {},
  sortDirection: 'oldest-first',

  cachedData: {},

  setSelectedLeadId: (id) => set({ selectedLeadId: id }),
  setLiveMode: (live) => set({ liveMode: live }),

  setShowFilters: (show) => set({ showFilters: show }),
  setRoleFilter: (filter) => set({ roleFilter: filter }),
  setCommFilter: (filter) => set({ commFilter: filter }),
  setHiddenStatuses: (statuses) => set({ hiddenStatuses: statuses }),

  toggleExpandedAgent: (leadId, agentId) =>
    set((s) => {
      const current = s.expandedAgents[leadId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return { expandedAgents: { ...s.expandedAgents, [leadId]: next } };
    }),

  expandMultipleAgents: (leadId, agentIds) =>
    set((s) => {
      if (agentIds.length === 0) return s;
      const current = s.expandedAgents[leadId] ?? new Set<string>();
      const next = new Set(current);
      let changed = false;
      for (const id of agentIds) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      if (!changed) return s;
      return { expandedAgents: { ...s.expandedAgents, [leadId]: next } };
    }),

  getExpandedAgents: (leadId) => get().expandedAgents[leadId] ?? EMPTY_SET,

  setExpandedAgents: (leadId, agentIds) =>
    set((s) => ({ expandedAgents: { ...s.expandedAgents, [leadId]: agentIds } })),

  setSortDirection: (dir) => set({ sortDirection: dir }),

  setCachedData: (leadId, data) =>
    set((s) => {
      const next = { ...s.cachedData, [leadId]: data };
      const keys = Object.keys(next);
      if (keys.length > MAX_CACHED_LEADS) {
        // Evict oldest entries (by insertion order) to stay within limit
        const toRemove = keys.slice(0, keys.length - MAX_CACHED_LEADS);
        for (const key of toRemove) delete next[key];
      }
      return { cachedData: next };
    }),

  getCachedData: (leadId) => get().cachedData[leadId] ?? null,

  clearCachedData: (leadId) =>
    set((s) => {
      const { [leadId]: _, ...rest } = s.cachedData;
      return { cachedData: rest };
    }),

  reset: () =>
    set({
      selectedLeadId: null,
      liveMode: true,
      showFilters: false,
      roleFilter: new Set(ALL_ROLES),
      commFilter: new Set(ALL_COMM_TYPES),
      hiddenStatuses: new Set(),
      expandedAgents: {},
      sortDirection: 'oldest-first',
      cachedData: {},
    }),
}));
