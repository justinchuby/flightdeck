import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './useApi';
import {
  PLAYBACK_TICK_MS,
  STATE_FETCH_DEBOUNCE_MS,
  MIN_SESSION_DURATION_MS,
} from '../constants/timing';

// ── Types ────────────────────────────────────────────────────────────

export interface ReplayKeyframe {
  timestamp: string;
  label: string;
  type: 'spawn' | 'agent_exit' | 'delegation' | 'task' | 'milestone' | 'decision' | 'progress' | 'error' | 'commit';
  agentId?: string;
}

export interface ReplayAgentState {
  id: string;
  role: string;
  status: string;
  contextUsedPct?: number;
}

export interface ReplayWorldState {
  timestamp: string;
  agents: ReplayAgentState[];
  pendingDecisions: number;
  completedTasks: number;
  totalTasks: number;
  /** Full task DAG state at this point in time (from server WorldState) */
  dagTasks?: ReplayDagTask[];
  /** Decision log entries at this point in time */
  decisions?: ReplayDecision[];
  /** Recent activity entries near this timestamp */
  recentActivity?: ReplayActivityEntry[];
}

export interface ReplayDagTask {
  id: string;
  description?: string;
  role?: string;
  dagStatus: string;
  assignedTo?: string;
  dependencies?: string[];
}

export interface ReplayDecision {
  id: string;
  summary: string;
  status: string;
  agentRole?: string;
  timestamp?: string;
}

export interface ReplayActivityEntry {
  id: number;
  agentId: string;
  agentRole: string;
  actionType: string;
  summary: string;
  timestamp: string;
}

export interface UseSessionReplayResult {
  keyframes: ReplayKeyframe[];
  worldState: ReplayWorldState | null;
  playing: boolean;
  currentTime: number; // ms since session start
  duration: number;    // total session duration ms
  loading: boolean;
  error: string | null;
  play: () => void;
  pause: () => void;
  seek: (timeMs: number) => void;
  setSpeed: (speed: number) => void;
  speed: number;
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Manages session replay state: keyframe loading, playback, and world state reconstruction.
 * Fetches keyframes from GET /api/replay/:leadId/keyframes
 * On seek, fetches GET /api/replay/:leadId/state?at=<iso>
 */
export function useSessionReplay(leadId: string | null): UseSessionReplayResult {
  const [worldState, setWorldState] = useState<ReplayWorldState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(4);

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number>(0);

  // Load keyframes via TanStack Query
  const { data: keyframeData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['replay', 'keyframes', leadId],
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ keyframes: ReplayKeyframe[] }>(
        `/replay/${leadId}/keyframes`,
        { signal },
      );
      return data.keyframes ?? [];
    },
    enabled: !!leadId,
  });

  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  const keyframes = keyframeData ?? [];

  // Derive duration and sessionStart from keyframes
  useEffect(() => {
    // Reset playback state when switching projects
    setCurrentTime(0);
    setPlaying(false);
    setWorldState(null);
    sessionStartRef.current = 0;

    if (keyframes.length > 0) {
      const start = new Date(keyframes[0].timestamp).getTime();
      const end = new Date(keyframes[keyframes.length - 1].timestamp).getTime();
      sessionStartRef.current = start;
      setDuration(Math.max(end - start, MIN_SESSION_DURATION_MS));
    } else {
      setDuration(0);
    }
  }, [leadId, keyframes]);

  // Fetch world state at a given time offset
  const fetchStateAt = useCallback(async (timeMs: number) => {
    if (!leadId || sessionStartRef.current === 0) return;
    const iso = new Date(sessionStartRef.current + timeMs).toISOString();
    try {
      const state = await apiFetch<ReplayWorldState>(
        `/replay/${leadId}/state?at=${encodeURIComponent(iso)}`,
      );
      setWorldState(state);
    } catch {
      // Best-effort — don't interrupt playback
    }
  }, [leadId]);

  // Playback loop
  useEffect(() => {
    if (playing) {
      const tickMs = PLAYBACK_TICK_MS;
      playIntervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + tickMs * speed;
          if (next >= duration) {
            setPlaying(false);
            return duration;
          }
          return next;
        });
      }, tickMs);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [playing, speed, duration]);

  // Fetch world state when currentTime changes significantly (debounce 300ms)
  const lastFetchRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastFetchRef.current < STATE_FETCH_DEBOUNCE_MS) return;
    lastFetchRef.current = now;
    fetchStateAt(currentTime);
  }, [currentTime, fetchStateAt]);

  const play = useCallback(() => {
    if (currentTime >= duration) setCurrentTime(0);
    setPlaying(true);
  }, [currentTime, duration]);

  const pause = useCallback(() => setPlaying(false), []);

  const seek = useCallback((timeMs: number) => {
    const clamped = Math.max(0, Math.min(timeMs, duration));
    setCurrentTime(clamped);
    setPlaying(false);
    fetchStateAt(clamped);
  }, [duration, fetchStateAt]);

  return {
    keyframes, worldState, playing, currentTime, duration,
    loading, error, play, pause, seek, setSpeed, speed,
  };
}
