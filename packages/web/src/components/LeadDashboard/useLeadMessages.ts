import { useEffect, useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLeadStore } from '../../stores/leadStore';
import { useMessageStore } from '../../stores/messageStore';
import { apiFetch } from '../../hooks/useApi';
import type { AcpTextChunk } from '../../types';

/** Shape returned by /api/agents/:id/messages and /api/projects/:id/messages */
interface MessageHistoryResponse {
  messages: Array<{
    id?: number;
    content: string;
    sender: string;
    timestamp: string;
    fromRole?: string;
  }>;
  hasMore?: boolean;
}

/** Shape returned by /api/lead — list of active lead agents */
interface LeadListItem {
  id: string;
  status: string;
  role?: string;
  projectId?: string;
}

/** Convert server messages to AcpTextChunk with optional dbId */
function toChunks(msgs: MessageHistoryResponse['messages']): (AcpTextChunk & { _dbId?: number })[] {
  return msgs.map((m) => ({
    type: 'text' as const,
    text: m.content,
    sender: m.sender as 'agent' | 'user' | 'system' | 'external' | 'thinking',
    ...(m.fromRole ? { fromRole: m.fromRole } : {}),
    timestamp: new Date(m.timestamp).getTime(),
    _dbId: m.id,
  }));
}

/**
 * Handles lead discovery on mount and message history loading for the selected lead.
 * Also manages WS subscription lifecycle and scroll-to-top pagination.
 */
export function useLeadMessages(
  selectedLeadId: string | null,
  readOnly: boolean,
  ws: { subscribe: (id: string) => void; unsubscribe: (id: string) => void },
  chatInitialScroll: React.MutableRefObject<boolean>,
) {
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Oldest DB message ID we've seen — used as cursor for pagination */
  const oldestIdRef = useRef<number | null>(null);
  /** Ref-based lock to prevent overlapping pagination requests (state is async) */
  const loadingRef = useRef(false);

  // Reset pagination state when switching leads
  useEffect(() => {
    setHasMore(true);
    setLoadingOlder(false);
    loadingRef.current = false;
    oldestIdRef.current = null;
  }, [selectedLeadId]);

  // On mount, load existing leads from server (skip in read-only mode — data pre-loaded)
  useQuery({
    queryKey: ['leads', 'initial'],
    queryFn: async ({ signal }) => {
      const leads: LeadListItem[] = await apiFetch('/lead', { signal });
      if (!Array.isArray(leads)) return [];
      const store = useLeadStore.getState();
      for (const l of leads) {
        store.addProject(l.id);
        // Pre-load message history for each lead (best-effort)
        apiFetch<MessageHistoryResponse>(`/agents/${l.id}/messages?limit=200&includeSystem=true`, { signal })
          .then((data) => {
            if (Array.isArray(data?.messages) && data.messages.length > 0) {
              useMessageStore.getState().mergeHistory(l.id, toChunks(data.messages));
            }
          })
          .catch(() => { /* non-critical — will load via WS */ });
      }
      if (!store.selectedLeadId) {
        const running = leads.find((l) => l.status === 'running');
        if (running) store.selectLead(running.id);
      }
      return leads;
    },
    enabled: !readOnly,
    staleTime: 30_000,
  });

  // Subscribe to selected lead WS stream
  useEffect(() => {
    if (!selectedLeadId) return;
    chatInitialScroll.current = false;
    if (!readOnly) {
      ws.subscribe(selectedLeadId);
    }
    return () => {
      if (!readOnly && selectedLeadId) ws.unsubscribe(selectedLeadId);
    };
  }, [selectedLeadId, ws, readOnly, chatInitialScroll]);

  // Load message history for selected lead.
  // Always fetch once (staleTime prevents re-fetches) — even if WS messages
  // arrived first, we need the full history from the DB to show older messages.
  const needsHistory = !!selectedLeadId;
  const msgApiPath = selectedLeadId
    ? `/agents/${selectedLeadId}/messages?limit=200&includeSystem=true`
    : '';

  useQuery({
    queryKey: ['lead', 'messages', selectedLeadId],
    queryFn: async ({ signal }) => {
      const data: MessageHistoryResponse = await apiFetch(msgApiPath, { signal });
      if (Array.isArray(data?.messages) && data.messages.length > 0) {
        const chunks = toChunks(data.messages);
        useMessageStore.getState().mergeHistory(selectedLeadId!, chunks);
        // Track oldest ID for cursor pagination
        const ids = data.messages.map((m) => m.id).filter((id): id is number => id != null);
        if (ids.length > 0) oldestIdRef.current = Math.min(...ids);
      }
      setHasMore(data?.hasMore ?? false);
      return data;
    },
    enabled: needsHistory,
    staleTime: 60_000,
  });

  /** Load older messages (scroll-to-top pagination) */
  const loadOlderMessages = useCallback(async () => {
    if (!selectedLeadId || !hasMore || loadingRef.current || oldestIdRef.current == null) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const data: MessageHistoryResponse = await apiFetch(
        `/agents/${selectedLeadId}/messages?limit=50&before=${oldestIdRef.current}&includeSystem=true`,
      );
      if (Array.isArray(data?.messages) && data.messages.length > 0) {
        const chunks = toChunks(data.messages);
        useMessageStore.getState().prependHistory(selectedLeadId, chunks);
        const ids = data.messages.map((m) => m.id).filter((id): id is number => id != null);
        if (ids.length > 0) oldestIdRef.current = Math.min(...ids);
      }
      setHasMore(data?.hasMore ?? false);
    } catch {
      // Non-critical — user can retry by scrolling up again
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [selectedLeadId, hasMore]);

  return { hasMore, loadingOlder, loadOlderMessages };
}
