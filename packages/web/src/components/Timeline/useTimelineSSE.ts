import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimelineData } from './useTimelineData';

export type ConnectionHealth = 'connected' | 'connecting' | 'reconnecting' | 'degraded' | 'offline';

export interface UseTimelineSSEResult {
  data: TimelineData | null;
  loading: boolean;
  error: string | null;
  connectionHealth: ConnectionHealth;
  /** True if SSE has permanently failed and caller should use polling fallback */
  sseUnavailable: boolean;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const SEEN_EVENT_ID_MAX_SIZE = 10_000;

export function useTimelineSSE(leadId: string | null): UseTimelineSSEResult {
  const eventSourceSupported = typeof EventSource !== 'undefined';
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(!eventSourceSupported ? false : true);
  const [error, setError] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>(
    eventSourceSupported ? 'connecting' : 'offline'
  );
  const [sseUnavailable, setSseUnavailable] = useState(!eventSourceSupported);

  const eventSourceRef = useRef<EventSource | null>(null);
  const seenEventIds = useRef(new Set<string>());
  const consecutiveFailures = useRef(0);
  const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventId = useRef<string | null>(null);
  const hasDataRef = useRef(false);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const trackSeenId = useCallback((id: string) => {
    const seen = seenEventIds.current;
    seen.add(id);
    // Prune oldest entries when set grows too large
    if (seen.size > SEEN_EVENT_ID_MAX_SIZE) {
      const iter = seen.values();
      for (let i = 0; i < SEEN_EVENT_ID_MAX_SIZE / 2; i++) {
        const val = iter.next().value;
        if (val !== undefined) seen.delete(val);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!leadId || sseUnavailable) return;

    cleanup();

    const url = new URL('/api/coordination/timeline/stream', window.location.origin);
    url.searchParams.set('leadId', leadId);
    if (lastEventId.current) {
      url.searchParams.set('lastEventId', lastEventId.current);
    }

    const eventSource = new EventSource(url.toString());
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('init', (event: MessageEvent) => {
      const eventId = (event as any).lastEventId;
      if (eventId && seenEventIds.current.has(eventId)) return;
      if (eventId) {
        trackSeenId(eventId);
        lastEventId.current = eventId;
      }

      try {
        const payload: TimelineData = JSON.parse(event.data);
        setData(payload);
        hasDataRef.current = true;
        setLoading(false);
        setError(null);
        setConnectionHealth('connected');
        consecutiveFailures.current = 0;
        reconnectDelay.current = INITIAL_RECONNECT_DELAY_MS;
      } catch {
        setError('Failed to parse SSE init data');
      }
    });

    eventSource.addEventListener('reconnect', (event: MessageEvent) => {
      const eventId = (event as any).lastEventId;
      if (eventId && seenEventIds.current.has(eventId)) return;
      if (eventId) trackSeenId(eventId);

      try {
        const payload: TimelineData = JSON.parse(event.data);
        setData(payload);
        hasDataRef.current = true;
        setLoading(false);
        setError(null);
        setConnectionHealth('connected');
        consecutiveFailures.current = 0;
        reconnectDelay.current = INITIAL_RECONNECT_DELAY_MS;
      } catch {
        setError('Failed to parse SSE reconnect data');
      }
    });

    eventSource.addEventListener('activity', (event: MessageEvent) => {
      const eventId = (event as any).lastEventId;
      if (eventId && seenEventIds.current.has(eventId)) return;
      if (eventId) {
        trackSeenId(eventId);
        lastEventId.current = eventId;
      }

      try {
        const { entry } = JSON.parse(event.data);
        setData(prev => prev ? mergeActivityEntry(prev, entry) : prev);
      } catch {
        // Ignore malformed incremental events
      }
    });

    eventSource.addEventListener('lock', (event: MessageEvent) => {
      const eventId = (event as any).lastEventId;
      if (eventId && seenEventIds.current.has(eventId)) return;
      if (eventId) trackSeenId(eventId);

      try {
        const lockEvent = JSON.parse(event.data);
        setData(prev => prev ? mergeLockEvent(prev, lockEvent) : prev);
      } catch {
        // Ignore malformed lock events
      }
    });

    eventSource.onopen = () => {
      setConnectionHealth('connected');
      setError(null);
      consecutiveFailures.current = 0;
      reconnectDelay.current = INITIAL_RECONNECT_DELAY_MS;
    };

    eventSource.onerror = () => {
      consecutiveFailures.current++;

      if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES) {
        cleanup();
        setSseUnavailable(true);
        setConnectionHealth('offline');
        setError('SSE connection failed — falling back to polling');
        return;
      }

      setConnectionHealth(hasDataRef.current ? 'reconnecting' : 'connecting');

      // EventSource auto-reconnects, but we track the state
      // If EventSource is CLOSED (not just errored), schedule manual reconnect
      if (eventSource.readyState === EventSource.CLOSED) {
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };
  }, [leadId, sseUnavailable, cleanup, trackSeenId]);

  useEffect(() => {
    if (!leadId) {
      setData(null);
      setLoading(false);
      setConnectionHealth('offline');
      return;
    }

    // Don't reset connection state if SSE has been marked unavailable
    if (sseUnavailable) return;

    setLoading(true);
    setConnectionHealth('connecting');
    connect();

    return cleanup;
  }, [leadId, connect, cleanup, sseUnavailable]);

  return { data, loading, error, connectionHealth, sseUnavailable };
}

/** Merge an incremental activity entry into existing timeline data */
function mergeActivityEntry(prev: TimelineData, entry: any): TimelineData {
  const communications = [...prev.communications];
  const agents = prev.agents.map(a => ({ ...a, segments: [...a.segments] }));
  const locks = [...prev.locks];

  // Update agent segments for status_change
  if (entry.actionType === 'status_change') {
    let agent = agents.find(a => a.id === entry.agentId);
    if (!agent) {
      agent = {
        id: entry.agentId,
        shortId: entry.agentId.slice(0, 8),
        role: entry.agentRole,
        createdAt: entry.timestamp,
        segments: [],
      };
      agents.push(agent);
    }
    // Close previous segment
    if (agent.segments.length > 0) {
      const lastSeg = agent.segments[agent.segments.length - 1];
      if (!lastSeg.endAt) {
        agent.segments[agent.segments.length - 1] = { ...lastSeg, endAt: entry.timestamp };
      }
    }
    const statusMatch = entry.summary?.match(/^Status:\s*(.+)$/);
    const status = statusMatch ? statusMatch[1] : entry.summary;
    agent.segments.push({ status, startAt: entry.timestamp });
    if (['completed', 'failed', 'terminated'].includes(status)) {
      agent.endedAt = entry.timestamp;
    }
  }

  // Append communication events
  if (entry.actionType === 'delegated' && entry.details?.childId) {
    communications.push({
      type: 'delegation' as const,
      fromAgentId: entry.agentId,
      toAgentId: entry.details.childId,
      summary: (entry.summary ?? '').slice(0, 120),
      timestamp: entry.timestamp,
    });
  } else if (entry.actionType === 'message_sent' && entry.details?.toAgentId) {
    const isBroadcast = entry.details.toRole === 'broadcast' || entry.details.toAgentId === 'all';
    communications.push({
      type: isBroadcast ? 'broadcast' : 'message',
      fromAgentId: entry.agentId,
      toAgentId: entry.details.toAgentId,
      summary: (entry.summary ?? '').slice(0, 120),
      timestamp: entry.timestamp,
    });
  } else if (entry.actionType === 'group_message' && entry.details?.groupName) {
    communications.push({
      type: 'group_message',
      fromAgentId: entry.agentId,
      toAgentId: undefined as any,
      groupName: entry.details.groupName,
      summary: (entry.summary ?? '').slice(0, 120),
      timestamp: entry.timestamp,
    });
  }

  // Update time range
  const timeRange = {
    start: prev.timeRange.start,
    end: entry.timestamp > prev.timeRange.end ? entry.timestamp : prev.timeRange.end,
  };

  return { ...prev, agents, communications, locks, timeRange };
}

/** Merge an incremental lock event into existing timeline data */
function mergeLockEvent(prev: TimelineData, lockEvent: any): TimelineData {
  const locks = [...prev.locks];

  if (lockEvent.type === 'acquired') {
    locks.push({
      agentId: lockEvent.agentId,
      filePath: lockEvent.filePath,
      acquiredAt: lockEvent.timestamp || new Date().toISOString(),
    });
  } else if (lockEvent.type === 'released') {
    const openIndex = locks.findIndex(
      l => l.agentId === lockEvent.agentId && l.filePath === lockEvent.filePath && !l.releasedAt
    );
    if (openIndex >= 0) {
      locks[openIndex] = {
        ...locks[openIndex],
        releasedAt: lockEvent.timestamp || new Date().toISOString(),
      };
    }
  }

  return { ...prev, locks };
}
