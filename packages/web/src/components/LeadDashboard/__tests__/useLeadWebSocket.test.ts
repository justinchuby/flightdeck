// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mock stores & utils ────────────────────────────────────────

const mockStore = {
  selectedLeadId: 'lead-1',
  projects: { 'lead-1': {} },
  addDecision: vi.fn(),
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

const mockMessageStore = {
  appendToLastAgentMessage: vi.fn(),
  appendToThinkingMessage: vi.fn(),
  addMessage: vi.fn(),
  promoteQueuedMessages: vi.fn(),
  ensureChannel: vi.fn(),
};

vi.mock('../../../stores/messageStore', () => ({
  useMessageStore: { getState: () => mockMessageStore },
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
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

describe('useLeadWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.selectedLeadId = 'lead-1';
    mockStore.projects = { 'lead-1': {} };
  });

  afterEach(() => {
    // renderHook cleanup removes the listener
  });

  it('registers and cleans up ws-message listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    expect(addSpy).toHaveBeenCalledWith('ws-message', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('ws-message', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('handles lead:decision messages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'lead:decision',
      agentId: 'lead-1',
      leadId: 'lead-1',
      id: 42,
      title: 'Use React',
      rationale: 'Best fit',
      needsConfirmation: true,
      status: 'recorded',
    });
    expect(mockStore.addDecision).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      id: '42',
      title: 'Use React',
      needsConfirmation: true,
    }));
  });

  it('handles agent:text messages for selected lead', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:text', agentId: 'lead-1', text: 'hello world' });
    expect(mockMessageStore.appendToLastAgentMessage).toHaveBeenCalledWith('lead-1', 'hello world');
  });

  it('ignores agent:text messages for non-selected agents', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:text', agentId: 'other-agent', text: 'nope' });
    expect(mockMessageStore.appendToLastAgentMessage).not.toHaveBeenCalled();
  });

  it('handles agent:text with object payload', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:text', agentId: 'lead-1', text: { text: 'from object' } });
    expect(mockMessageStore.appendToLastAgentMessage).toHaveBeenCalledWith('lead-1', 'from object');
  });

  it('handles agent:thinking messages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:thinking', agentId: 'lead-1', text: 'thinking...' });
    expect(mockMessageStore.appendToThinkingMessage).toHaveBeenCalledWith('lead-1', 'thinking...');
  });

  it('handles agent:content messages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:content',
      agentId: 'lead-1',
      content: { text: 'content text', contentType: 'text' },
    });
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      text: 'content text',
      sender: 'agent',
    }));
  });

  it('handles agent:status running → promoteQueuedMessages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:status', agentId: 'lead-1', status: 'running' });
    expect(mockMessageStore.promoteQueuedMessages).toHaveBeenCalledWith('lead-1');
  });

  it('handles agent:tool_call for lead', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:tool_call',
      agentId: 'lead-1',
      toolCall: { toolCallId: 'tc-1', title: 'Reading file', status: 'started' },
    });
    expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'tool_call',
      summary: 'Reading file',
    }));
  });

  it('handles agent:tool_call for child of lead', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:tool_call',
      agentId: 'child-1',
      toolCall: { toolCallId: 'tc-2', kind: 'bash' },
    });
    expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      agentId: 'child-1',
      summary: 'bash',
    }));
  });

  it('ignores agent:tool_call from unrelated agents', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:tool_call',
      agentId: 'unrelated-agent',
      toolCall: { toolCallId: 'tc-3', title: 'ignored' },
    });
    expect(mockStore.addActivity).not.toHaveBeenCalled();
  });

  it('handles agent:delegated messages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:delegated',
      parentId: 'lead-1',
      childId: 'child-1',
      delegation: { id: 'del-1', toRole: 'Developer', task: 'Implement feature X' },
    });
    expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'delegation',
    }));
    expect(mockStore.addComm).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'delegation',
      fromId: 'lead-1',
      toId: 'child-1',
    }));
  });

  it('handles agent:completion_reported messages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:completion_reported',
      parentId: 'lead-1',
      childId: 'child-1',
      status: 'completed',
    });
    expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'completion',
    }));
    expect(mockStore.addComm).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'report',
    }));
  });

  it('handles lead:progress messages', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'lead:progress',
      agentId: 'lead-1',
      summary: 'Making progress',
      completed: ['task-1'],
      in_progress: ['task-2'],
      blocked: [],
    });
    expect(mockStore.setProgressSummary).toHaveBeenCalledWith('lead-1', 'Making progress');
    expect(mockStore.addProgressSnapshot).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      summary: 'Making progress',
      completed: ['task-1'],
      inProgress: ['task-2'],
    }));
    expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'progress_update',
    }));
  });

  it('handles agent:message_sent from lead', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:message_sent',
      from: 'lead-1',
      to: 'child-1',
      fromRole: 'Lead',
      toRole: 'Developer',
      content: 'Please review this',
    });
    expect(mockStore.addComm).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      fromId: 'lead-1',
      toId: 'child-1',
      type: 'message',
    }));
    // Lead-to-agent messages appear in chat
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      sender: 'system',
    }));
  });

  it('handles agent:message_sent TO lead (agent reports)', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:message_sent',
      from: 'child-1',
      to: 'lead-1',
      fromRole: 'Developer',
      content: 'Task completed',
    });
    expect(mockStore.addAgentReport).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      fromRole: 'Developer',
      fromId: 'child-1',
      content: 'Task completed',
    }));
  });

  it('handles group:message', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'group:message',
      leadId: 'lead-1',
      groupName: 'backend-team',
      message: { fromAgentId: 'child-1', fromRole: 'Developer', content: 'Group msg' },
    });
    expect(mockStore.addGroupMessage).toHaveBeenCalledWith('lead-1', 'backend-team', expect.objectContaining({
      content: 'Group msg',
    }));
    expect(mockStore.addComm).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      type: 'group_message',
    }));
  });

  it('handles dag:updated by fetching DAG', async () => {
    const { apiFetch } = await import('../../../hooks/useApi');
    vi.mocked(apiFetch).mockResolvedValue({ tasks: [{ id: 't1' }] });

    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'dag:updated', leadId: 'lead-1' });

    // apiFetch is called asynchronously
    await vi.waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/lead/lead-1/dag');
    });
  });

  it('handles agent:context_compacted for lead agent', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:context_compacted',
      agentId: 'lead-1',
      percentDrop: 40,
    });
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      sender: 'system',
      text: expect.stringContaining('40%'),
    }));
  });

  it('handles agent:context_compacted for child agent', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:context_compacted',
      agentId: 'child-1',
      percentDrop: 25,
    });
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      text: expect.stringContaining('25%'),
    }));
  });

  it('ignores messages when no selectedLeadId', () => {
    mockStore.selectedLeadId = null;
    renderHook(() => useLeadWebSocket(agents, null));
    emitWsMessage({ type: 'agent:tool_call', agentId: 'lead-1', toolCall: { toolCallId: 'tc-x', title: 'test' } });
    expect(mockStore.addActivity).not.toHaveBeenCalled();
  });

  // ── direct UUID matching tests (project:xxx pattern removed) ──

  describe('direct UUID matching (no project:xxx resolution)', () => {
    const agents: AgentInfo[] = [
      { id: 'agent-uuid-1', status: 'running', projectId: 'proj-1', role: { id: 'lead', name: 'Lead' } } as AgentInfo,
      { id: 'child-2', status: 'running', parentId: 'agent-uuid-1', role: { id: 'developer', name: 'Developer' } } as AgentInfo,
    ];

    beforeEach(() => {
      mockStore.selectedLeadId = 'agent-uuid-1';
      (mockStore as Record<string, unknown>).projects = { 'agent-uuid-1': {} };
    });

    it('matches agent:text by direct UUID', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:text', agentId: 'agent-uuid-1', text: 'hello' });
      expect(mockMessageStore.appendToLastAgentMessage).toHaveBeenCalledWith('project:proj-1', 'hello');
    });

    it('matches agent:thinking by direct UUID', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:thinking', agentId: 'agent-uuid-1', text: 'pondering' });
      expect(mockMessageStore.appendToThinkingMessage).toHaveBeenCalledWith('project:proj-1', 'pondering');
    });

    it('resolves project:xxx to lead agentId for agent:content', () => {
      renderHook(() => useLeadWebSocket(projAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:content',
        agentId: 'agent-uuid-1',
        content: { text: 'content text', contentType: 'text' },
      });
      expect(mockMessageStore.addMessage).toHaveBeenCalledWith(
        'project:proj-1',
        expect.objectContaining({ text: 'content text', sender: 'agent' }),
      );
    });

    it('resolves project:xxx to lead agentId for agent:status running', () => {
      renderHook(() => useLeadWebSocket(projAgents, 'proj-1'));
      emitWsMessage({ type: 'agent:status', agentId: 'agent-uuid-1', status: 'running' });
      expect(mockMessageStore.promoteQueuedMessages).toHaveBeenCalledWith('project:proj-1');
    });

    it('resolves project:xxx to lead agentId for agent:tool_call', () => {
      renderHook(() => useLeadWebSocket(projAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:tool_call',
        agentId: 'agent-uuid-1',
        toolCall: { toolCallId: 'tc-resolve', title: 'running tool' },
      });
      expect(mockStore.addActivity).toHaveBeenCalledWith(
        'agent-uuid-1',
        expect.objectContaining({ agentId: 'agent-uuid-1', type: 'tool_call' }),
      );
    });

    it('does not resolve when no matching lead agent exists', () => {
      const noLeadAgents: AgentInfo[] = [
        { id: 'child-only', status: 'running', projectId: 'other-proj', role: { id: 'developer', name: 'Developer' } } as AgentInfo,
      ];
      renderHook(() => useLeadWebSocket(noLeadAgents, 'proj-1'));
      emitWsMessage({ type: 'agent:text', agentId: 'agent-uuid-1', text: 'should not match' });
      expect(mockMessageStore.appendToLastAgentMessage).not.toHaveBeenCalled();
    });

    it('matches group:message by leadId', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({
        type: 'group:message',
        leadId: 'agent-uuid-1',
        groupName: 'grp-1',
        message: { fromAgentId: 'child-2', fromRole: 'Developer', content: 'group msg' },
      });
      expect(mockStore.addGroupMessage).toHaveBeenCalledWith(
        'agent-uuid-1',
        'grp-1',
        expect.objectContaining({ fromAgentId: 'child-2' }),
      );
    });
  });
});
