import { create } from 'zustand';
import type { TimerInfo } from '../types';

/** Tracks removal timeouts for fired timers — cleared on early removal */
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
      get().removeTimer(timerId);
    }, delayMs);
    fireTimeouts.set(timerId, timeout);
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
