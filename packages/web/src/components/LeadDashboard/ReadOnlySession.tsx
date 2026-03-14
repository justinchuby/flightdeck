import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { LeadDashboard } from './LeadDashboard';
import type { AcpTextChunk, DagStatus, Decision, ChatGroup, LeadProgress } from '../../types';

/**
 * Route wrapper that renders LeadDashboard in read-only mode for a historical session.
 * Mounted at /projects/:id/sessions/:leadId
 */
export function ReadOnlySession() {
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
      apiFetch<{ messages: Array<{ sender?: string; content?: string; text?: string; timestamp?: number }> }>(`/agents/${leadId}/messages?limit=1000&includeSystem=true`, opts)
        .then((data) => {
          if (controller.signal.aborted) return;
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            const msgs: AcpTextChunk[] = data.messages.map((m) => ({
              type: 'text' as const,
              text: m.content || m.text || '',
              sender: m.sender as 'agent' | 'user' | 'system' | 'thinking',
              timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
            }));
            useLeadStore.getState().setMessages(leadId, msgs);
          }
        }),
      apiFetch<Decision[]>(`/lead/${leadId}/decisions`, opts)
        .then((data) => {
          if (controller.signal.aborted || !Array.isArray(data)) return;
          useLeadStore.getState().setDecisions(leadId, data);
        }),
      apiFetch<ChatGroup[]>(`/lead/${leadId}/groups`, opts)
        .then((data) => {
          if (controller.signal.aborted || !Array.isArray(data)) return;
          useLeadStore.getState().setGroups(leadId, data);
        }),
      apiFetch<DagStatus>(`/lead/${leadId}/dag`, opts)
        .then((data) => {
          if (controller.signal.aborted || !data?.tasks) return;
          useLeadStore.getState().setDagStatus(leadId, data);
        }),
      apiFetch<LeadProgress>(`/lead/${leadId}/progress`, opts)
        .then((data) => {
          if (controller.signal.aborted || !data || ('error' in data)) return;
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

  return <LeadDashboard readOnly />;
}
