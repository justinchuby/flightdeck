import { create } from 'zustand';
import type { TimerInfo } from '../types';
import { apiFetch } from '../hooks/useApi';

// Module-level timeout tracking for the singleton Zustand store.
// Can't live in useRef (store actions aren't React components) or in Zustand state
// (setTimeout handles aren't serializable). Cleared via _clearAllFireTimeouts() in tests.
const fireTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

interface TimerState {
  timers: TimerInfo[];
  /** Timer IDs that recently fired — shown with green flash before removal */
  recentlyFiredIds: string[];

  setTimers: (timers: TimerInfo[]) => void;
  addTimer: (timer: TimerInfo) => void;
  fireTimer: (timerId: string) => void;
  removeTimer: (timerId: string) => void;
  clearRecentlyFired: (timerId: string) => void;
  /** Schedule auto-removal after fired flash. Returns cleanup function. */
  scheduleFireRemoval: (timerId: string, delayMs?: number) => void;
  /** Create a timer via the REST API and add it to the store */
  createTimer: (input: { agentId: string; label: string; message: string; delaySeconds: number; repeat: boolean }) => Promise<TimerInfo>;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  timers: [],
  recentlyFiredIds: [],

  setTimers: (timers) => set({ timers }),

  addTimer: (timer) =>
    set((s) => {
      // If timer:fired arrived before timer:created, mark it as fired
      const alreadyFired = s.recentlyFiredIds.includes(timer.id);
      const resolved = alreadyFired
        ? { ...timer, status: 'fired' as const, remainingMs: 0 }
        : timer;
      return {
        timers: s.timers.some((t) => t.id === timer.id)
          ? s.timers.map((t) => (t.id === timer.id ? resolved : t))
          : [...s.timers, resolved],
      };
    }),

  fireTimer: (timerId) =>
    set((s) => ({
      timers: s.timers.map((t) =>
        t.id === timerId ? { ...t, status: 'fired' as const, remainingMs: 0 } : t,
      ),
      recentlyFiredIds: s.recentlyFiredIds.includes(timerId)
        ? s.recentlyFiredIds
        : [...s.recentlyFiredIds, timerId],
    })),

  removeTimer: (timerId) => {
    // Clear any pending fire-removal timeout
    const existing = fireTimeouts.get(timerId);
    if (existing) {
      clearTimeout(existing);
      fireTimeouts.delete(timerId);
    }
    set((s) => ({
      timers: s.timers.filter((t) => t.id !== timerId),
      recentlyFiredIds: s.recentlyFiredIds.filter((id) => id !== timerId),
    }));
  },

  clearRecentlyFired: (timerId) =>
    set((s) => ({
      recentlyFiredIds: s.recentlyFiredIds.filter((id) => id !== timerId),
    })),

  scheduleFireRemoval: (timerId, delayMs = 2000) => {
    // Clear any existing timeout for this timer
    const existing = fireTimeouts.get(timerId);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
      fireTimeouts.delete(timerId);
      get().clearRecentlyFired(timerId);
    }, delayMs);
    fireTimeouts.set(timerId, timeout);
  },

  createTimer: async (input) => {
    const timer = await apiFetch<TimerInfo>('/timers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    // WebSocket timer:created event will add it to the store
    return timer;
  },
}));

/** Count of active (pending) timers */
export function selectActiveTimerCount(s: TimerState): number {
  return s.timers.filter((t) => t.status === 'pending').length;
}

/** Exposed for testing — clears all fire timeouts */
export function _clearAllFireTimeouts(): void {
  for (const timeout of fireTimeouts.values()) clearTimeout(timeout);
  fireTimeouts.clear();
}
