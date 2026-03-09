import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAppStore } from '../../stores/appStore';

// Mock apiFetch
const mockApiFetch = vi.fn().mockResolvedValue({});
vi.mock('../useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  getAuthToken: () => null,
}));

/**
 * Simulates the decision handling logic from useWebSocket.ts
 * to test oversight-level gating in isolation.
 */
function simulateDecisionArrival(msg: {
  id: string;
  needsConfirmation: boolean;
  projectId?: string;
  agentId?: string;
  agentRole?: string;
  title?: string;
}) {
  if (msg.needsConfirmation && msg.id) {
    const effectiveLevel = useSettingsStore.getState().getEffectiveLevel(msg.projectId ?? undefined);
    if (effectiveLevel === 'minimal') {
      mockApiFetch(`/decisions/${msg.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      return;
    }
    useAppStore.getState().addPendingDecision({
      id: msg.id,
      agentId: msg.agentId || 'agent-1',
      agentRole: msg.agentRole || 'Developer',
      leadId: null,
      projectId: msg.projectId ?? null,
      title: msg.title || 'Test decision',
      rationale: '',
      needsConfirmation: true,
      status: 'recorded',
      autoApproved: false,
      confirmedAt: null,
      category: 'general',
      timestamp: new Date().toISOString(),
    });
  }
}

describe('oversight auto-approve', () => {
  beforeEach(() => {
    mockApiFetch.mockClear();
    useAppStore.setState({ pendingDecisions: [] });
    useSettingsStore.getState().setOversightLevel('standard');
  });

  it('adds decision to pendingDecisions when oversight is standard', () => {
    useSettingsStore.getState().setOversightLevel('standard');
    simulateDecisionArrival({ id: 'dec-1', needsConfirmation: true });

    expect(useAppStore.getState().pendingDecisions).toHaveLength(1);
    expect(useAppStore.getState().pendingDecisions[0].id).toBe('dec-1');
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('adds decision to pendingDecisions when oversight is detailed', () => {
    useSettingsStore.getState().setOversightLevel('detailed');
    simulateDecisionArrival({ id: 'dec-2', needsConfirmation: true });

    expect(useAppStore.getState().pendingDecisions).toHaveLength(1);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('auto-approves via API when oversight is minimal', () => {
    useSettingsStore.getState().setOversightLevel('minimal');
    simulateDecisionArrival({ id: 'dec-3', needsConfirmation: true });

    expect(useAppStore.getState().pendingDecisions).toHaveLength(0);
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/decisions/dec-3/confirm',
      { method: 'POST', body: '{}' },
    );
  });

  it('respects per-project oversight override', () => {
    useSettingsStore.getState().setOversightLevel('detailed');
    useSettingsStore.getState().setProjectOversight('project-abc', 'minimal');

    simulateDecisionArrival({ id: 'dec-4', needsConfirmation: true, projectId: 'project-abc' });

    expect(useAppStore.getState().pendingDecisions).toHaveLength(0);
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/decisions/dec-4/confirm',
      { method: 'POST', body: '{}' },
    );
  });

  it('uses global level when project has no override', () => {
    useSettingsStore.getState().setOversightLevel('minimal');

    simulateDecisionArrival({ id: 'dec-5', needsConfirmation: true, projectId: 'project-xyz' });

    expect(useAppStore.getState().pendingDecisions).toHaveLength(0);
    expect(mockApiFetch).toHaveBeenCalled();
  });

  it('skips decisions without needsConfirmation', () => {
    useSettingsStore.getState().setOversightLevel('standard');
    simulateDecisionArrival({ id: 'dec-6', needsConfirmation: false });

    expect(useAppStore.getState().pendingDecisions).toHaveLength(0);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
