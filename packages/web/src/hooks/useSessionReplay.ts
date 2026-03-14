import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [keyframes, setKeyframes] = useState<ReplayKeyframe[]>([]);
  const [worldState, setWorldState] = useState<ReplayWorldState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const sessionStartRef = useRef<number>(0);

  // Load keyframes on mount / leadId change
  useEffect(() => {
    mountedRef.current = true;

    // Reset playback state when switching projects
    setCurrentTime(0);
    setPlaying(false);
    setWorldState(null);
    sessionStartRef.current = 0;

    if (!leadId) {
      setKeyframes([]);
      setDuration(0);
      return;
    }

    const loadKeyframes = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ keyframes: ReplayKeyframe[] }>(
          `/replay/${leadId}/keyframes`,
        );
        if (!mountedRef.current) return;
        const kf = data.keyframes ?? [];
        setKeyframes(kf);
        if (kf.length > 0) {
          const start = new Date(kf[0].timestamp).getTime();
          const end = new Date(kf[kf.length - 1].timestamp).getTime();
          sessionStartRef.current = start;
          setDuration(Math.max(end - start, MIN_SESSION_DURATION_MS));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (mountedRef.current) setError(message ?? 'Failed to load keyframes');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    loadKeyframes();
    return () => { mountedRef.current = false; };
  }, [leadId]);

  // Fetch world state at a given time offset
  const fetchStateAt = useCallback(async (timeMs: number) => {
    if (!leadId || sessionStartRef.current === 0) return;
    const iso = new Date(sessionStartRef.current + timeMs).toISOString();
    try {
      const state = await apiFetch<ReplayWorldState>(
        `/replay/${leadId}/state?at=${encodeURIComponent(iso)}`,
      );
      if (mountedRef.current) setWorldState(state);
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
