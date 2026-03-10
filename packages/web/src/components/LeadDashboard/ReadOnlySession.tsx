import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { LeadDashboard } from './LeadDashboard';
import type { AcpTextChunk, DagStatus } from '../../types';

interface ReadOnlySessionProps {
  api: any;
  ws: any;
}

/**
 * Route wrapper that renders LeadDashboard in read-only mode for a historical session.
 * Mounted at /projects/:id/sessions/:leadId
 */
export function ReadOnlySession({ api, ws }: ReadOnlySessionProps) {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const previousLeadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!leadId) return;
    const store = useLeadStore.getState();

    // Save current selection to restore on unmount
    previousLeadRef.current = store.selectedLeadId;

    // Ensure project entry exists in store
    if (!store.projects[leadId]) {
      store.addProject(leadId);
    }
    store.selectLead(leadId);

    const controller = new AbortController();
    const opts = { signal: controller.signal };

    // Fire-and-forget historical data fetches.
    // Endpoints may 404 for old sessions — allSettled ignores individual failures.
    Promise.allSettled([
      apiFetch<{ messages: any[] }>(`/agents/${leadId}/messages?limit=1000&includeSystem=true`, opts)
        .then((data) => {
          if (controller.signal.aborted) return;
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            const msgs: AcpTextChunk[] = data.messages.map((m: any) => ({
              type: 'text' as const,
              text: m.content,
              sender: m.sender as 'agent' | 'user' | 'system' | 'thinking',
              timestamp: new Date(m.timestamp).getTime(),
            }));
            useLeadStore.getState().setMessages(leadId, msgs);
          }
        }),
      apiFetch<any[]>(`/lead/${leadId}/decisions`, opts)
        .then((data) => {
          if (controller.signal.aborted || !Array.isArray(data)) return;
          useLeadStore.getState().setDecisions(leadId, data);
        }),
      apiFetch<any[]>(`/lead/${leadId}/groups`, opts)
        .then((data) => {
          if (controller.signal.aborted || !Array.isArray(data)) return;
          useLeadStore.getState().setGroups(leadId, data);
        }),
      apiFetch<any>(`/lead/${leadId}/dag`, opts)
        .then((data) => {
          if (controller.signal.aborted || !data?.tasks) return;
          useLeadStore.getState().setDagStatus(leadId, data as DagStatus);
        }),
      apiFetch<any>(`/lead/${leadId}/progress`, opts)
        .then((data) => {
          if (controller.signal.aborted || !data || data.error) return;
          useLeadStore.getState().setProgress(leadId, data);
        }),
    ]);

    return () => {
      controller.abort();
      // Restore previous lead selection when navigating away
      const prev = previousLeadRef.current;
      if (prev) {
        useLeadStore.getState().selectLead(prev);
      }
    };
  }, [leadId]);

  if (!leadId) {
    navigate(-1);
    return null;
  }

  return <LeadDashboard api={api} ws={ws} readOnly />;
}
