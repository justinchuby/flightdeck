import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────

export interface SinceLastVisitResult {
  /** Number of new events since the last visit */
  newEventCount: number;
  /** Index position of the last-seen marker in the events array, or -1 if not found */
  lastSeenMarkerPosition: number;
  /** Mark all current events as seen (persists to localStorage) */
  markAsSeen: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'timeline-last-seen-event-';

function getStorageKey(sessionKey: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionKey}`;
}

// ── Hook ──────────────────────────────────────────────────────────────

/**
 * Tracks the last-seen event ID in localStorage to show a "since last visit" badge.
 *
 * @param eventIds - Ordered array of all current event IDs (oldest first)
 * @param sessionKey - Unique key for this timeline session (e.g. lead agent ID)
 */
export function useSinceLastVisit(
  eventIds: string[],
  sessionKey: string,
): SinceLastVisitResult {
  const storageKey = getStorageKey(sessionKey);
  const eventIdsRef = useRef(eventIds);
  eventIdsRef.current = eventIds;

  // Read last-seen ID from localStorage on mount
  const [lastSeenEventId, setLastSeenEventId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });

  // Compute marker position — graceful fallback if ID references pruned event
  const lastSeenMarkerPosition = useMemo(
    () => (lastSeenEventId ? eventIds.indexOf(lastSeenEventId) : -1),
    [eventIds, lastSeenEventId],
  );

  // If the stored ID is not found in current events, treat as first visit (fallback)
  const effectiveMarkerPosition =
    lastSeenEventId && lastSeenMarkerPosition === -1
      ? -1 // pruned event — treat as first visit
      : lastSeenMarkerPosition;

  const newEventCount =
    effectiveMarkerPosition === -1
      ? 0 // first visit or pruned — no "new" badge
      : eventIds.length - effectiveMarkerPosition - 1;

  // Persist the latest event ID to localStorage
  const persistLastSeen = useCallback(() => {
    const ids = eventIdsRef.current;
    if (ids.length === 0) return;

    const latestId = ids[ids.length - 1];
    try {
      localStorage.setItem(storageKey, latestId);
    } catch {
      // localStorage may be full or unavailable — silently ignore
    }
    setLastSeenEventId(latestId);
  }, [storageKey]);

  // markAsSeen: callable by the consumer to mark all events as seen
  const markAsSeen = useCallback(() => {
    persistLastSeen();
  }, [persistLastSeen]);

  // Persist on page unload and visibilitychange
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistLastSeen();
      }
    };

    const handleBeforeUnload = () => {
      persistLastSeen();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [persistLastSeen]);

  return {
    newEventCount: Math.max(0, newEventCount),
    lastSeenMarkerPosition: effectiveMarkerPosition,
    markAsSeen,
  };
}
