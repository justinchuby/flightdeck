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

  // agent:text, agent:thinking, and agent:content are handled by the global WS
  // dispatcher (ws-handlers/agentTextHandlers), NOT by useLeadWebSocket.
  // This avoids double-writes to the messageStore channel.

  it('does not handle agent:text (handled by global dispatcher)', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:text', agentId: 'lead-1', text: 'hello world' });
    expect(mockMessageStore.appendToLastAgentMessage).not.toHaveBeenCalled();
  });

  it('ignores agent:text messages for non-selected agents', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:text', agentId: 'other-agent', text: 'nope' });
    expect(mockMessageStore.appendToLastAgentMessage).not.toHaveBeenCalled();
  });

  it('does not handle agent:thinking (handled by global dispatcher)', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({ type: 'agent:thinking', agentId: 'lead-1', text: 'thinking...' });
    expect(mockMessageStore.appendToThinkingMessage).not.toHaveBeenCalled();
  });

  it('does not handle agent:content (handled by global dispatcher)', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:content',
      agentId: 'lead-1',
      content: { text: 'content text', contentType: 'text' },
    });
    expect(mockMessageStore.addMessage).not.toHaveBeenCalled();
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

  // project:xxx resolution removed by eliminate-project-key refactor

  /* ================================================================== */
  /*  Branch coverage — partial conditions on changed lines             */
  /* ================================================================== */

  describe('agent:text/thinking/content from non-lead are ignored', () => {
    it('ignores agent:thinking from non-lead agent', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:thinking', agentId: 'other-agent', text: 'nope' });
      expect(mockMessageStore.appendToThinkingMessage).not.toHaveBeenCalled();
    });

    it('ignores agent:content from non-lead agent', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({
        type: 'agent:content',
        agentId: 'other-agent',
        content: { text: 'ignored', contentType: 'text' },
      });
      expect(mockMessageStore.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('agent:status branch coverage', () => {
    it('does NOT call promoteQueuedMessages for non-running status', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:status', agentId: 'lead-1', status: 'idle' });
      expect(mockMessageStore.promoteQueuedMessages).not.toHaveBeenCalled();
    });

    it('ignores agent:status from non-lead agent', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:status', agentId: 'other-agent', status: 'running' });
      expect(mockMessageStore.promoteQueuedMessages).not.toHaveBeenCalled();
    });
  });

  describe('resolveToolSummary fallback branch', () => {
    it('falls back to JSON.stringify when title and kind are undefined', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({
        type: 'agent:tool_call',
        agentId: 'lead-1',
        toolCall: { toolCallId: 'tc-fallback', title: undefined, kind: undefined },
      });
      expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
        summary: '"Working..."',
      }));
    });

    it('uses title.text when title is an object with text', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({
        type: 'agent:tool_call',
        agentId: 'lead-1',
        toolCall: { toolCallId: 'tc-obj-title', title: { text: 'Object title' } },
      });
      expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
        summary: 'Object title',
      }));
    });
  });

  describe('lead:progress with blocked items', () => {
    it('includes blocked items in activity summary', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({
        type: 'lead:progress',
        agentId: 'lead-1',
        summary: 'Working',
        completed: [],
        in_progress: ['task-1'],
        blocked: ['task-2', 'task-3'],
      });
      expect(mockStore.addActivity).toHaveBeenCalledWith('lead-1', expect.objectContaining({
        summary: expect.stringContaining('Blocked: task-2, task-3'),
      }));
    });
  });

  describe('agent:message_sent system→lead', () => {
    it('surfaces system-to-lead message in chat with ⚙️ prefix', () => {
      // 'system' must be a known child-of-lead so the guard at line 289 passes
      const agentsWithSystem: AgentInfo[] = [
        ...agents,
        { id: 'system', status: 'running', parentId: 'lead-1', role: { id: 'system', name: 'System' } } as AgentInfo,
      ];
      renderHook(() => useLeadWebSocket(agentsWithSystem, 'proj-1'));
      emitWsMessage({
        type: 'agent:message_sent',
        from: 'system',
        to: 'lead-1',
        fromRole: 'System',
        content: 'Auto-approved decision',
      });
      expect(mockMessageStore.addMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
        sender: 'system',
        text: expect.stringContaining('⚙️'),
      }));
      expect(mockMessageStore.addMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
        text: expect.stringContaining('Auto-approved decision'),
      }));
    });
  });

  /* ================================================================== */
  /*  Null leadId — false branches for if(leadId) guards                */
  /* ================================================================== */

  describe('null selectedLeadId', () => {
    beforeEach(() => {
      mockStore.selectedLeadId = null;
    });

    it('ignores agent:tool_call when leadId is null', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:tool_call', agentId: 'lead-1', toolCall: { toolCallId: 'tc', title: 'test' } });
      expect(mockStore.addActivity).not.toHaveBeenCalled();
    });

    it('ignores agent:message_sent when leadId is null', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'agent:message_sent', from: 'lead-1', to: 'child-1', content: 'hello' });
      expect(mockStore.addComm).not.toHaveBeenCalled();
    });

    it('ignores group:created when leadId is null', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'group:created', leadId: null });
      expect(mockStore.setGroups).not.toHaveBeenCalled();
    });

    it('ignores group:message when leadId is null', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'group:message', leadId: null, groupName: 'team', message: { fromAgentId: 'a', fromRole: 'Dev', content: 'hi' } });
      expect(mockStore.addGroupMessage).not.toHaveBeenCalled();
    });

    it('ignores dag:updated when leadId is null', () => {
      renderHook(() => useLeadWebSocket(agents, 'proj-1'));
      emitWsMessage({ type: 'dag:updated', leadId: null });
      expect(mockStore.setDagStatus).not.toHaveBeenCalled();
    });
  });

  /* ================================================================== */
  /*  message_sent from unrelated agent (line 287-289 early return)     */
  /* ================================================================== */

  it('ignores agent:message_sent from unrelated agents', () => {
    renderHook(() => useLeadWebSocket(agents, 'proj-1'));
    emitWsMessage({
      type: 'agent:message_sent',
      from: 'unrelated-agent',
      to: 'another-unrelated',
      content: 'private chat',
    });
    expect(mockStore.addComm).not.toHaveBeenCalled();
  });
});
