import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import type { AcpTextChunk } from '../../types';

/** Shape returned by /api/agents/:id/messages and /api/projects/:id/messages */
interface MessageHistoryResponse {
  messages: Array<{
    content: string;
    sender: string;
    timestamp: string;
    fromRole?: string;
  }>;
}

/** Shape returned by /api/lead — list of active lead agents */
interface LeadListItem {
  id: string;
  status: string;
  role?: string;
  projectId?: string;
}

/**
 * Handles lead discovery on mount and message history loading for the selected lead.
 * Also manages WS subscription lifecycle.
 */
export function useLeadMessages(
  selectedLeadId: string | null,
  readOnly: boolean,
  ws: { subscribe: (id: string) => void; unsubscribe: (id: string) => void },
  chatInitialScroll: React.MutableRefObject<boolean>,
) {
  const projects = useLeadStore((s) => s.projects);

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
              const msgs: AcpTextChunk[] = data.messages.map((m) => ({
                type: 'text' as const,
                text: m.content,
                sender: m.sender as 'agent' | 'user' | 'system' | 'thinking',
                timestamp: new Date(m.timestamp).getTime(),
              }));
              const current = useLeadStore.getState().projects[l.id];
              if (!current || current.messages.length === 0) {
                useLeadStore.getState().setMessages(l.id, msgs);
              }
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

  // Load message history for selected lead — always fetch + merge with live WS messages
  const selectedProj = selectedLeadId ? projects[selectedLeadId] : null;
  const msgApiPath = selectedLeadId
    ? `/agents/${selectedLeadId}/messages?limit=200&includeSystem=true`
    : '';

  useQuery({
    queryKey: ['lead', 'messages', selectedLeadId],
    queryFn: async ({ signal }) => {
      const data: MessageHistoryResponse = await apiFetch(msgApiPath, { signal });
      if (Array.isArray(data?.messages) && data.messages.length > 0) {
        const msgs: AcpTextChunk[] = data.messages.map((m) => ({
          type: 'text' as const,
          text: m.content,
          sender: m.sender as 'agent' | 'user' | 'system' | 'external' | 'thinking',
          ...(m.fromRole ? { fromRole: m.fromRole } : {}),
          timestamp: new Date(m.timestamp).getTime(),
        }));
        const current = useLeadStore.getState().projects[selectedLeadId!];
        if (!current || current.messages.length === 0) {
          useLeadStore.getState().setMessages(selectedLeadId!, msgs);
        } else {
          // Merge: DB history first, then any live WS messages newer than the latest historical
          const latestHistTs = Math.max(...msgs.map((m) => m.timestamp ?? 0));
          const liveOnly = current.messages.filter((m) => (m.timestamp ?? 0) > latestHistTs);
          useLeadStore.getState().setMessages(selectedLeadId!, [...msgs, ...liveOnly]);
        }
      }
      return data;
    },
    enabled: !!selectedLeadId,
    staleTime: 60_000,
  });
}
