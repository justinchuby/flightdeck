import { useCallback } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';

export function useDecisionActions(selectedLeadId: string | null) {
  const handleConfirmDecision = useCallback(async (decisionId: string, reason?: string) => {
    if (!selectedLeadId) return;
    // Optimistic update — hide buttons immediately
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'confirmed', confirmedAt: new Date().toISOString() });
    const decision = await apiFetch(`/decisions/${decisionId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
  }, [selectedLeadId]);

  const handleRejectDecision = useCallback(async (decisionId: string, reason?: string) => {
    if (!selectedLeadId) return;
    // Optimistic update — hide buttons immediately
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'rejected', confirmedAt: new Date().toISOString() });
    const decision = await apiFetch(`/decisions/${decisionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
  }, [selectedLeadId]);

  const handleDismissDecision = useCallback(async (decisionId: string) => {
    if (!selectedLeadId) return;
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'dismissed', confirmedAt: new Date().toISOString() });
    const decision = await apiFetch(`/decisions/${decisionId}/dismiss`, {
      method: 'POST',
    });
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
  }, [selectedLeadId]);

  return { handleConfirmDecision, handleRejectDecision, handleDismissDecision };
}
