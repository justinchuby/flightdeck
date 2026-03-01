import { create } from 'zustand';
import type { TimelineData, CommType, TimelineStatus } from '../components/Timeline/useTimelineData';

// ── Types ────────────────────────────────────────────────────────────

export type SortDirection = 'newest-first' | 'oldest-first';

const ALL_ROLES = ['lead', 'architect', 'developer', 'code-reviewer', 'critical-reviewer', 'designer', 'secretary', 'qa-tester'];
const ALL_COMM_TYPES: CommType[] = ['delegation', 'message', 'group_message', 'broadcast'];

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
  getExpandedAgents: (leadId: string) => Set<string>;
  setSortDirection: (dir: SortDirection) => void;
  setCachedData: (leadId: string, data: TimelineData) => void;
  getCachedData: (leadId: string) => TimelineData | null;
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

  getExpandedAgents: (leadId) => get().expandedAgents[leadId] ?? new Set<string>(),

  setSortDirection: (dir) => set({ sortDirection: dir }),

  setCachedData: (leadId, data) =>
    set((s) => ({ cachedData: { ...s.cachedData, [leadId]: data } })),

  getCachedData: (leadId) => get().cachedData[leadId] ?? null,

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
