import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WsHandlerContext } from '../types';

// --- Mock external stores/utils used by handlers ---
const mockToastAdd = vi.fn();
vi.mock('../../../components/Toast', () => ({
  useToastStore: { getState: () => ({ add: mockToastAdd }) },
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/commandParser', () => ({
  hasUnclosedCommandBlock: vi.fn(() => false),
}));

const mockGroupStore = {
  addGroup: vi.fn(),
  addMessage: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
};
vi.mock('../../../stores/groupStore', () => ({
  useGroupStore: { getState: () => mockGroupStore },
  groupKey: (leadId: string, groupName: string) => `${leadId}:${groupName}`,
}));

const mockTimerStore = {
  addTimer: vi.fn(),
  fireTimer: vi.fn(),
  scheduleFireRemoval: vi.fn(),
  removeTimer: vi.fn(),
};
vi.mock('../../../stores/timerStore', () => ({
  useTimerStore: { getState: () => mockTimerStore },
}));

let mockOversightLevel = 'supervised';
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ getEffectiveLevel: () => mockOversightLevel }) },
}));

const mockApiFetch = vi.fn(() => Promise.resolve());
vi.mock('../../useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// --- Import handlers after mocks ---
import {
  handleInit, handleAgentSpawned, handleAgentTerminated, handleAgentExit,
  handleAgentStatus, handleSubSpawned, handleSpawnError, handleModelFallback,
  handleSessionReady, handleSessionResumeFailed,
} from '../agentStatusHandlers';
import { handleAgentText, handleResponseStart, handleAgentContent } from '../agentTextHandlers';
import { handleAgentThinking } from '../agentThinkingHandlers';
import { handleAgentPlan, handleAgentUsage } from '../agentDataHandlers';
import { handleToolCall } from '../toolCallHandlers';
import { handleMessageSent } from '../messagingHandlers';
import {
  handleGroupCreated, handleGroupMessage, handleGroupMemberAdded,
  handleGroupMemberRemoved, handleGroupReaction,
} from '../groupHandlers';
import {
  handleSystemPaused, handleTimerCreated, handleTimerFired, handleTimerCancelled,
  handleLeadDecision, handleDecisionResolved, handleDecisionsBatch, handleAttentionChanged,
} from '../systemHandlers';
import { createMessageDispatcher } from '../index';

// --- Test utilities ---
function makeCtx(agents: any[] = []): WsHandlerContext {
  const state = {
    agents,
    setLoading: vi.fn(),
    setSystemPaused: vi.fn(),
    addPendingDecision: vi.fn(),
    removePendingDecision: vi.fn(),
  };
  return {
    setAgents: vi.fn(),
    addAgent: vi.fn(),
    updateAgent: vi.fn(),
    getAppState: () => state,
    pendingNewlineRef: { current: new Set<string>() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOversightLevel = 'supervised';
});

// ── Agent Status Handlers ─────────────────────────────────────────

describe('agentStatusHandlers', () => {
  it('handleInit sets agents and loading=false', () => {
    const ctx = makeCtx();
    handleInit({ agents: [{ id: 'a1' }] }, ctx);
    expect(ctx.setAgents).toHaveBeenCalledWith([{ id: 'a1' }]);
    expect(ctx.getAppState().setLoading).toHaveBeenCalledWith(false);
  });

  it('handleInit sets systemPaused when present', () => {
    const ctx = makeCtx();
    handleInit({ agents: [], systemPaused: true }, ctx);
    expect(ctx.getAppState().setSystemPaused).toHaveBeenCalledWith(true);
  });

  it('handleAgentSpawned adds agent', () => {
    const ctx = makeCtx();
    handleAgentSpawned({ agent: { id: 'a1' } }, ctx);
    expect(ctx.addAgent).toHaveBeenCalledWith({ id: 'a1' });
  });

  it('handleAgentTerminated sets terminated status', () => {
    const ctx = makeCtx();
    handleAgentTerminated({ agentId: 'a1' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', { status: 'terminated' });
  });

  it('handleAgentExit sets completed on code 0', () => {
    const ctx = makeCtx([{ id: 'a1', status: 'running' }]);
    handleAgentExit({ agentId: 'a1', code: 0 }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({ status: 'completed' }));
  });

  it('handleAgentExit sets failed on non-zero code', () => {
    const ctx = makeCtx([{ id: 'a1', status: 'running' }]);
    handleAgentExit({ agentId: 'a1', code: 1, error: 'oops' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({ status: 'failed', exitError: 'oops' }));
  });

  it('handleAgentExit does not overwrite terminated', () => {
    const ctx = makeCtx([{ id: 'a1', status: 'terminated' }]);
    handleAgentExit({ agentId: 'a1', code: 1 }, ctx);
    expect(ctx.updateAgent).not.toHaveBeenCalled();
  });

  it('handleSubSpawned adds child and updates parent', () => {
    const ctx = makeCtx([{ id: 'p1', childIds: [] }]);
    handleSubSpawned({ parentId: 'p1', child: { id: 'c1' } }, ctx);
    expect(ctx.addAgent).toHaveBeenCalledWith({ id: 'c1' });
    expect(ctx.updateAgent).toHaveBeenCalledWith('p1', { childIds: ['c1'] });
  });

  it('handleSpawnError shows toast', () => {
    const ctx = makeCtx([{ id: 'a1', role: { name: 'Developer' } }]);
    handleSpawnError({ agentId: 'a1', message: 'no capacity' }, ctx);
    expect(mockToastAdd).toHaveBeenCalledWith('error', expect.stringContaining('Spawn failed'));
  });

  it('handleModelFallback updates model and shows toast', () => {
    const ctx = makeCtx();
    handleModelFallback({ agentId: 'a1', requested: 'gpt-4', resolved: 'gpt-3.5', provider: 'openai', agentRole: 'Dev', reason: 'quota' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({ model: 'gpt-3.5' }));
    expect(mockToastAdd).toHaveBeenCalledWith('info', expect.stringContaining('gpt-4'));
  });

  it('handleSessionReady updates sessionId', () => {
    const ctx = makeCtx();
    handleSessionReady({ agentId: 'a1', sessionId: 's1' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', { sessionId: 's1' });
  });

  it('handleSessionResumeFailed shows toast', () => {
    const ctx = makeCtx();
    handleSessionResumeFailed({ agentId: 'abc12345-long-id', error: 'timeout' }, ctx);
    expect(mockToastAdd).toHaveBeenCalledWith('error', expect.stringContaining('timeout'));
  });
});

// ── Agent Text Handlers ───────────────────────────────────────────

describe('agentTextHandlers', () => {
  it('handleAgentText appends to existing agent message', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [{ type: 'text', text: 'hello', sender: 'agent', timestamp: 1 }] }]);
    handleAgentText({ agentId: 'a1', text: ' world' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ text: 'hello world' })],
    });
  });

  it('handleAgentText creates new message when no existing', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [] }]);
    handleAgentText({ agentId: 'a1', text: 'first' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ text: 'first', sender: 'agent' })],
    });
  });

  it('handleAgentText normalizes object text', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [] }]);
    handleAgentText({ agentId: 'a1', text: { text: 'from obj' } }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ text: 'from obj' })],
    });
  });

  it('handleResponseStart sets pending newline flag', () => {
    const ctx = makeCtx();
    handleResponseStart({ agentId: 'a1' }, ctx);
    expect(ctx.pendingNewlineRef.current.has('a1')).toBe(true);
  });

  it('handleAgentContent pushes content message', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [] }]);
    handleAgentContent({ agentId: 'a1', content: { text: 'img', contentType: 'image', mimeType: 'image/png', data: 'base64' } }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ contentType: 'image', mimeType: 'image/png' })],
    });
  });
});

// ── Agent Thinking Handlers ───────────────────────────────────────

describe('agentThinkingHandlers', () => {
  it('handleAgentThinking creates thinking message', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [] }]);
    handleAgentThinking({ agentId: 'a1', text: 'reasoning...' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ text: 'reasoning...', sender: 'thinking' })],
    });
  });

  it('handleAgentThinking appends to existing thinking message', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [{ type: 'text', text: 'part1', sender: 'thinking', timestamp: 1 }] }]);
    handleAgentThinking({ agentId: 'a1', text: 'part2' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ text: 'part1part2' })],
    });
  });

  it('handleAgentThinking normalizes object text', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [] }]);
    handleAgentThinking({ agentId: 'a1', text: { text: 'thinking obj' } }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      messages: [expect.objectContaining({ text: 'thinking obj' })],
    });
  });

  it('handleAgentThinking skips empty text', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [] }]);
    handleAgentThinking({ agentId: 'a1', text: '' }, ctx);
    expect(ctx.updateAgent).not.toHaveBeenCalled();
  });
});

// ── Agent Data Handlers ───────────────────────────────────────────

describe('agentDataHandlers', () => {
  it('handleAgentPlan updates plan', () => {
    const ctx = makeCtx();
    handleAgentPlan({ agentId: 'a1', plan: [{ step: 1 }] }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', { plan: [{ step: 1 }] });
  });

  it('handleAgentUsage updates tokens with optional fields', () => {
    const ctx = makeCtx();
    handleAgentUsage({
      agentId: 'a1', inputTokens: 100, outputTokens: 50,
      cacheReadTokens: 10, cacheWriteTokens: 5,
      contextWindowUsed: 500, contextWindowSize: 4096,
    }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 10,
    }));
  });

  it('handleAgentUsage omits null optional fields', () => {
    const ctx = makeCtx();
    handleAgentUsage({ agentId: 'a1', inputTokens: 100, outputTokens: 50 }, ctx);
    const call = (ctx.updateAgent as any).mock.calls[0][1];
    expect(call).not.toHaveProperty('cacheReadTokens');
  });
});

// ── Tool Call Handlers ────────────────────────────────────────────

describe('toolCallHandlers', () => {
  it('handleToolCall adds new tool call and message', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [], toolCalls: [] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'bash', status: 'running', kind: 'bash' } }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({
      toolCalls: [expect.objectContaining({ toolCallId: 'tc1' })],
      messages: [expect.objectContaining({ sender: 'tool' })],
    }));
  });

  it('handleToolCall sets pending newline flag', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [], toolCalls: [] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'test', status: 'running' } }, ctx);
    expect(ctx.pendingNewlineRef.current.has('a1')).toBe(true);
  });

  it('handleToolCall only updates toolCalls when status unchanged', () => {
    const ctx = makeCtx([{ id: 'a1', messages: [], toolCalls: [{ toolCallId: 'tc1', status: 'running' }] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'test', status: 'running' } }, ctx);
    const call = (ctx.updateAgent as any).mock.calls[0][1];
    expect(call.messages).toBeUndefined();
  });
});

// ── Messaging Handlers ────────────────────────────────────────────

describe('messagingHandlers', () => {
  it('handleMessageSent shows in recipient panel', () => {
    const ctx = makeCtx([
      { id: 'from1', messages: [], role: { name: 'Dev' } },
      { id: 'to1', messages: [] },
    ]);
    handleMessageSent({ from: 'from1', to: 'to1', fromRole: 'Dev', content: 'hello' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('to1', expect.objectContaining({
      messages: [expect.objectContaining({ text: expect.stringContaining('📨') })],
    }));
  });

  it('handleMessageSent shows in sender panel', () => {
    const ctx = makeCtx([
      { id: 'from1', messages: [], role: { name: 'Dev' } },
      { id: 'to1', messages: [], role: { name: 'Arch' } },
    ]);
    handleMessageSent({ from: 'from1', to: 'to1', content: 'hello' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('from1', expect.objectContaining({
      messages: [expect.objectContaining({ text: expect.stringContaining('📤') })],
    }));
  });

  it('handleMessageSent from system uses system sender', () => {
    const ctx = makeCtx([{ id: 'to1', messages: [] }]);
    handleMessageSent({ from: 'system', to: 'to1', content: 'info' }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('to1', expect.objectContaining({
      messages: [expect.objectContaining({ sender: 'system', text: expect.stringContaining('⚙️') })],
    }));
  });
});

// ── Group Handlers ────────────────────────────────────────────────

describe('groupHandlers', () => {
  it('handleGroupCreated adds group', () => {
    handleGroupCreated({ name: 'team', leadId: 'l1', memberIds: ['a1'] });
    expect(mockGroupStore.addGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'team' }));
  });

  it('handleGroupMessage adds message', () => {
    handleGroupMessage({ message: { leadId: 'l1', groupName: 'team', text: 'hi' } });
    expect(mockGroupStore.addMessage).toHaveBeenCalledWith('l1:team', expect.objectContaining({ text: 'hi' }));
  });

  it('handleGroupMemberAdded adds member', () => {
    handleGroupMemberAdded({ leadId: 'l1', group: 'team', agentId: 'a1' });
    expect(mockGroupStore.addMember).toHaveBeenCalledWith('l1', 'team', 'a1');
  });

  it('handleGroupMemberRemoved removes member', () => {
    handleGroupMemberRemoved({ leadId: 'l1', group: 'team', agentId: 'a1' });
    expect(mockGroupStore.removeMember).toHaveBeenCalledWith('l1', 'team', 'a1');
  });

  it('handleGroupReaction adds reaction', () => {
    handleGroupReaction({ leadId: 'l1', groupName: 'team', messageId: 'm1', emoji: '👍', agentId: 'a1', action: 'add' });
    expect(mockGroupStore.addReaction).toHaveBeenCalledWith('l1:team', 'm1', '👍', 'a1');
  });

  it('handleGroupReaction removes reaction', () => {
    handleGroupReaction({ leadId: 'l1', groupName: 'team', messageId: 'm1', emoji: '👎', agentId: 'a1', action: 'remove' });
    expect(mockGroupStore.removeReaction).toHaveBeenCalledWith('l1:team', 'm1', '👎', 'a1');
  });
});

// ── System Handlers ───────────────────────────────────────────────

describe('systemHandlers', () => {
  it('handleSystemPaused updates state', () => {
    const ctx = makeCtx();
    handleSystemPaused({ paused: true }, ctx);
    expect(ctx.getAppState().setSystemPaused).toHaveBeenCalledWith(true);
  });

  it('handleTimerCreated adds timer', () => {
    handleTimerCreated({ timer: { id: 't1' } });
    expect(mockTimerStore.addTimer).toHaveBeenCalledWith({ id: 't1' });
  });

  it('handleTimerFired fires and schedules removal', () => {
    handleTimerFired({ timerId: 't1' });
    expect(mockTimerStore.fireTimer).toHaveBeenCalledWith('t1');
    expect(mockTimerStore.scheduleFireRemoval).toHaveBeenCalledWith('t1');
  });

  it('handleTimerFired uses timer.id fallback', () => {
    handleTimerFired({ timer: { id: 't2' } });
    expect(mockTimerStore.fireTimer).toHaveBeenCalledWith('t2');
  });

  it('handleTimerCancelled removes timer', () => {
    handleTimerCancelled({ timerId: 't1' });
    expect(mockTimerStore.removeTimer).toHaveBeenCalledWith('t1');
  });

  it('handleLeadDecision adds pending decision', () => {
    const ctx = makeCtx();
    handleLeadDecision({ needsConfirmation: true, id: 'd1', title: 'Use React', agentId: 'a1' }, ctx);
    expect(ctx.getAppState().addPendingDecision).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
  });

  it('handleLeadDecision auto-approves in autonomous mode', () => {
    mockOversightLevel = 'autonomous';
    const ctx = makeCtx();
    handleLeadDecision({ needsConfirmation: true, id: 'd1' }, ctx);
    expect(mockApiFetch).toHaveBeenCalledWith('/decisions/d1/confirm', expect.any(Object));
    expect(ctx.getAppState().addPendingDecision).not.toHaveBeenCalled();
  });

  it('handleDecisionResolved removes decision', () => {
    const ctx = makeCtx();
    handleDecisionResolved({ decisionId: 'd1' }, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d1');
  });

  it('handleDecisionsBatch removes all decisions', () => {
    const ctx = makeCtx();
    handleDecisionsBatch({ decisions: [{ id: 'd1' }, { id: 'd2' }] }, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledTimes(2);
  });

  it('handleAttentionChanged dispatches event', () => {
    const listener = vi.fn();
    window.addEventListener('attention:changed', listener);
    handleAttentionChanged();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('attention:changed', listener);
  });
});

// ── Dispatcher ────────────────────────────────────────────────────

describe('createMessageDispatcher', () => {
  it('dispatches known message types', () => {
    const ctx = makeCtx();
    const dispatch = createMessageDispatcher(ctx);
    dispatch({ type: 'agent:terminated', agentId: 'a1' });
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', { status: 'terminated' });
  });

  it('silently ignores unknown message types', () => {
    const ctx = makeCtx();
    const dispatch = createMessageDispatcher(ctx);
    expect(() => dispatch({ type: 'unknown:future_event' })).not.toThrow();
  });

  it('routes decision:confirmed and decision:rejected', () => {
    const ctx = makeCtx();
    const dispatch = createMessageDispatcher(ctx);
    dispatch({ type: 'decision:confirmed', decisionId: 'd1' });
    dispatch({ type: 'decision:rejected', id: 'd2' });
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d1');
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d2');
  });
});
