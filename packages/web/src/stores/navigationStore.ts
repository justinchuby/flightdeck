import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────

export interface NavEntry {
  path: string;
  projectId?: string;
  tab?: string;
  label?: string;
}

interface NavigationState {
  /** Current project ID (null when on global pages) */
  currentProjectId: string | null;
  /** Current project display name */
  currentProjectName: string | null;
  /** Active tab within a project */
  activeTab: string | null;
  /** Navigation history stack (most recent last) */
  history: NavEntry[];
  /** Forward stack for redo navigation */
  forward: NavEntry[];
  /** Badge counts keyed by category */
  badges: Record<string, number>;

  // ── Actions ───────────────────────────────────────────────────

  /** Update current project context */
  setProject: (id: string | null, name?: string | null) => void;
  /** Update active tab */
  setActiveTab: (tab: string | null) => void;
  /** Push a navigation entry onto history */
  pushEntry: (entry: NavEntry) => void;
  /** Go back one entry; returns the entry or null */
  goBack: () => NavEntry | null;
  /** Go forward one entry; returns the entry or null */
  goForward: () => NavEntry | null;
  /** Update a badge count */
  setBadge: (key: string, count: number) => void;
  /** Clear all badges */
  clearBadges: () => void;
}

// Max history entries to prevent unbounded growth
const MAX_HISTORY = 50;

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentProjectId: null,
  currentProjectName: null,
  activeTab: null,
  history: [],
  forward: [],
  badges: {},

  setProject: (id, name) =>
    set({ currentProjectId: id, currentProjectName: name ?? null }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  pushEntry: (entry) =>
    set((s) => {
      // Don't push duplicate of current top
      const top = s.history[s.history.length - 1];
      if (top?.path === entry.path) return s;
      const history = [...s.history, entry].slice(-MAX_HISTORY);
      return { history, forward: [] };
    }),

  goBack: () => {
    const s = get();
    if (s.history.length < 2) return null;
    const current = s.history[s.history.length - 1];
    const prev = s.history[s.history.length - 2];
    set({
      history: s.history.slice(0, -1),
      forward: [current!, ...s.forward],
      currentProjectId: prev!.projectId ?? null,
      activeTab: prev!.tab ?? null,
    });
    return prev!;
  },

  goForward: () => {
    const s = get();
    if (s.forward.length === 0) return null;
    const next = s.forward[0];
    set({
      history: [...s.history, next!],
      forward: s.forward.slice(1),
      currentProjectId: next!.projectId ?? null,
      activeTab: next!.tab ?? null,
    });
    return next!;
  },

  setBadge: (key, count) =>
    set((s) => ({ badges: { ...s.badges, [key]: count } })),

  clearBadges: () => set({ badges: {} }),
}));
