import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeadStore } from '../../stores/leadStore';
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

    // Fetch historical messages (include system messages for full context)
    fetch(`/api/agents/${leadId}/messages?limit=1000&includeSystem=true`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: any) => {
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
      })
      .catch(() => {});

    // Fetch historical decisions
    fetch(`/api/lead/${leadId}/decisions`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: any) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(data)) {
          useLeadStore.getState().setDecisions(leadId, data);
        }
      })
      .catch(() => {});

    // Fetch historical groups
    fetch(`/api/lead/${leadId}/groups`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: any) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(data)) {
          useLeadStore.getState().setGroups(leadId, data);
        }
      })
      .catch(() => {});

    // Fetch historical DAG
    fetch(`/api/lead/${leadId}/dag`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: any) => {
        if (controller.signal.aborted) return;
        if (data && data.tasks) {
          useLeadStore.getState().setDagStatus(leadId, data as DagStatus);
        }
      })
      .catch(() => {});

    // Fetch historical progress
    fetch(`/api/lead/${leadId}/progress`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: any) => {
        if (controller.signal.aborted) return;
        if (data && !data.error) {
          useLeadStore.getState().setProgress(leadId, data);
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [leadId]);

  if (!leadId) {
    navigate(-1);
    return null;
  }

  return <LeadDashboard api={api} ws={ws} readOnly />;
}
