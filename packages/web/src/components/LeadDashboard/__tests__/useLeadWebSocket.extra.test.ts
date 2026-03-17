// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mock stores & utils ────────────────────────────────────────

const mockStore: Record<string, any> = {
  selectedLeadId: 'lead-1',
  projects: { 'lead-1': {} },
  addDecision: vi.fn(),
  appendToLastAgentMessage: vi.fn(),
  appendToThinkingMessage: vi.fn(),
  addMessage: vi.fn(),
  promoteQueuedMessages: vi.fn(),
  addActivity: vi.fn(),
  addComm: vi.fn(),
  addAgentReport: vi.fn(),
  setProgressSummary: vi.fn(),
  addProgressSnapshot: vi.fn(),
  setGroups: vi.fn(),
  addGroupMessage: vi.fn(),
  setDagStatus: vi.fn(),
};

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: { getState: () => mockStore },
}));

let mockAppStoreAgents: any[] = [];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: { getState: () => ({ agents: mockAppStoreAgents }) },
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useLeadWebSocket } from '../useLeadWebSocket';
import type { AgentInfo } from '../../../types';

// ── Helpers ─────────────────────────────────────────────────────

function emitWsMessage(data: Record<string, unknown>) {
  const event = new MessageEvent('ws-message', { data: JSON.stringify(data) });
  window.dispatchEvent(event);
}

const agents: AgentInfo[] = [
  { id: 'lead-1', status: 'running', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
  { id: 'child-1', status: 'running', parentId: 'lead-1', role: { id: 'developer', name: 'Developer' } } as AgentInfo,
];

// ── Tests ────────────────────────────────────────────────────────

describe('useLeadWebSocket — uncovered lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.selectedLeadId = 'lead-1';
    mockStore.projects = { 'lead-1': {} };
  });

  it('handles group:created by fetching groups and calling setGroups (lines 331-332, 442-443)', async () => {
    const groupsData = [{ id: 'g1', name: 'backend-team' }];
    mockApiFetch.mockResolvedValue(groupsData);

    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'group:created', leadId: 'lead-1' });

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead/lead-1/groups');
    });
    await vi.waitFor(() => {
      expect(mockStore.setGroups).toHaveBeenCalledWith('lead-1', groupsData);
    });
  });

  it('group:created handles apiFetch failure gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'group:created', leadId: 'lead-1' });

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead/lead-1/groups');
    });
    // Should not throw; setGroups should not be called
    expect(mockStore.setGroups).not.toHaveBeenCalled();
  });

  it('group:created is ignored when leadId does not match selectedLeadId', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'group:created', leadId: 'other-lead' });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('group:created does not call setGroups when response is not an array (line 332)', async () => {
    mockApiFetch.mockResolvedValue({ notAnArray: true });

    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'group:created', leadId: 'lead-1' });

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead/lead-1/groups');
    });
    // Wait a tick for the .then() to resolve
    await new Promise(r => setTimeout(r, 10));
    expect(mockStore.setGroups).not.toHaveBeenCalled();
  });
});

// ── project:xxx resolution tests ────────────────────────────────

describe('useLeadWebSocket — project:xxx → UUID resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppStoreAgents = [];
  });

  it('resolves project:xxx to lead UUID using closure agents', () => {
    const agentsWithProject = [
      { id: 'lead-uuid-1', status: 'running', projectId: 'proj-abc', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
    ];
    mockStore.selectedLeadId = 'project:proj-abc';

    renderHook(() => useLeadWebSocket(agentsWithProject, null));

    emitWsMessage({ type: 'agent:text', agentId: 'lead-uuid-1', text: 'hello' });
    expect(mockStore.appendToLastAgentMessage).toHaveBeenCalledWith('project:proj-abc', 'hello');
  });

  it('resolves project:xxx using appStore fallback when closure agents is empty', () => {
    mockStore.selectedLeadId = 'project:proj-abc';
    mockAppStoreAgents = [
      { id: 'lead-uuid-2', status: 'running', projectId: 'proj-abc', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
    ];

    // Pass empty agents array — simulates stale closure during mount race
    renderHook(() => useLeadWebSocket([], null));

    emitWsMessage({ type: 'agent:text', agentId: 'lead-uuid-2', text: 'from appStore' });
    expect(mockStore.appendToLastAgentMessage).toHaveBeenCalledWith('project:proj-abc', 'from appStore');
  });

  it('drops agent:text when project:xxx resolution finds no matching lead', () => {
    mockStore.selectedLeadId = 'project:proj-unknown';
    mockAppStoreAgents = [];

    renderHook(() => useLeadWebSocket([], null));

    emitWsMessage({ type: 'agent:text', agentId: 'some-agent', text: 'orphan' });
    expect(mockStore.appendToLastAgentMessage).not.toHaveBeenCalled();
  });

  it('resolves project:xxx for agent:thinking via appStore fallback', () => {
    mockStore.selectedLeadId = 'project:proj-abc';
    mockAppStoreAgents = [
      { id: 'lead-uuid-3', status: 'running', projectId: 'proj-abc', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
    ];

    renderHook(() => useLeadWebSocket([], null));

    emitWsMessage({ type: 'agent:thinking', agentId: 'lead-uuid-3', text: 'reasoning...' });
    expect(mockStore.appendToThinkingMessage).toHaveBeenCalledWith('project:proj-abc', 'reasoning...');
  });

  it('skips terminated leads during project:xxx resolution', () => {
    mockStore.selectedLeadId = 'project:proj-abc';
    mockAppStoreAgents = [
      { id: 'dead-lead', status: 'terminated', projectId: 'proj-abc', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
      { id: 'live-lead', status: 'running', projectId: 'proj-abc', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
    ];

    renderHook(() => useLeadWebSocket([], null));

    emitWsMessage({ type: 'agent:text', agentId: 'live-lead', text: 'alive' });
    expect(mockStore.appendToLastAgentMessage).toHaveBeenCalledWith('project:proj-abc', 'alive');
  });
});
