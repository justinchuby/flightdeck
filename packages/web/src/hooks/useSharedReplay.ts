/**
 * Token-authenticated session replay hook for public share links.
 *
 * Routes ALL requests through /shared/:token/* endpoints to ensure
 * token validation and expiry checks on every state fetch.
 * This prevents the bypass where useSessionReplay(leadId) would
 * skip token validation after the initial metadata load.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiHttpError } from './useApi';
import type {
  ReplayKeyframe,
  ReplayWorldState,
  UseSessionReplayResult,
} from './useSessionReplay';
import {
  PLAYBACK_TICK_MS,
  STATE_FETCH_DEBOUNCE_MS,
  MIN_SESSION_DURATION_MS,
} from '../constants/timing';

// ── Types ────────────────────────────────────────────────────────────

/** Response from GET /shared/:token — initial metadata + keyframes */
export interface SharedReplayData {
  leadId: string;
  label?: string;
  expiresAt?: string;
  keyframes: ReplayKeyframe[];
  state?: ReplayWorldState;
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Token-routed replay hook for shared/public replay viewers.
 * All requests go through /shared/:token/* — never /replay/:leadId/*.
 */
export function useSharedReplay(token: string | null): UseSessionReplayResult & {
  /** Initial metadata from the share link */
  sharedData: SharedReplayData | null;
} {
  const [worldState, setWorldState] = useState<ReplayWorldState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(4);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef<number>(0);

  // Load initial data (keyframes + metadata) via share token
  const { data: sharedData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['shared-replay', token],
    queryFn: async ({ signal }) => {
      const data = await apiFetch<SharedReplayData>(
        `/shared/${token}`,
        { signal },
      );
      return data;
    },
    enabled: !!token,
    retry: (failureCount, error) => {
      // Don't retry on auth failures (expired/revoked tokens)
      if (error instanceof ApiHttpError && [401, 403, 404].includes(error.status)) return false;
      return failureCount < 2;
    },
  });

  const keyframes = sharedData?.keyframes ?? [];
  const error = tokenError
    ?? (queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null);

  // Set initial world state from metadata only if no keyframes (static snapshot).
  // When keyframes exist, let the time-based fetch populate the state to stay in sync.
  useEffect(() => {
    if (sharedData?.state && keyframes.length === 0) {
      setWorldState(sharedData.state);
    }
  }, [sharedData, keyframes.length]);

  // Derive duration and sessionStart from keyframes
  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
    setWorldState(null);
    sessionStartRef.current = 0;
    setTokenError(null);

    if (keyframes.length > 0) {
      const start = new Date(keyframes[0].timestamp).getTime();
      const end = new Date(keyframes[keyframes.length - 1].timestamp).getTime();
      sessionStartRef.current = start;
      setDuration(Math.max(end - start, MIN_SESSION_DURATION_MS));
    } else {
      setDuration(0);
    }
  }, [token, keyframes]);

  // Fetch world state at a given time offset — routed through share token
  const fetchStateAt = useCallback(async (timeMs: number) => {
    if (!token || sessionStartRef.current === 0) return;
    const iso = new Date(sessionStartRef.current + timeMs).toISOString();
    try {
      const state = await apiFetch<ReplayWorldState>(
        `/shared/${token}/state?at=${encodeURIComponent(iso)}`,
      );
      setWorldState(state);
      setTokenError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiHttpError && [401, 403, 404].includes(err.status)) {
        // Token expired or revoked — surface error, stop playback
        setTokenError('Share link has expired or been revoked');
        setPlaying(false);
      }
      // Other errors: best-effort, don't interrupt playback
    }
  }, [token]);

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

  // Fetch world state when currentTime changes (debounced)
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
    sharedData: sharedData ?? null,
  };
}
