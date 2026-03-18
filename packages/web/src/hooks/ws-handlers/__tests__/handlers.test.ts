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

const mockMessageStore = {
  channels: {} as Record<string, any>,
  ensureChannel: vi.fn(),
  addMessage: vi.fn(),
  setMessages: vi.fn(),
  appendToLastAgentMessage: vi.fn(),
  appendToThinkingMessage: vi.fn(),
  setPendingNewline: vi.fn(),
  mergeHistory: vi.fn(),
};
vi.mock('../../../stores/messageStore', () => ({
  useMessageStore: { getState: () => mockMessageStore },
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
  mockMessageStore.channels = {};
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

  it('handleAgentExit sets exitCode null when code is undefined', () => {
    const ctx = makeCtx([{ id: 'a1', status: 'running' }]);
    handleAgentExit({ agentId: 'a1' } as any, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({ exitCode: null }));
  });

  it('handleAgentStatus inserts turn separator on idle→running', () => {
    mockMessageStore.channels = {
      'a1': {
        messages: [
          { type: 'text', text: 'hello', sender: 'agent', timestamp: Date.now() - 5000 },
        ],
      },
    };
    const ctx = makeCtx([{ id: 'a1', status: 'idle' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', { status: 'running' });
    expect(mockMessageStore.setMessages).toHaveBeenCalledWith('a1', expect.arrayContaining([
      expect.objectContaining({ text: '---', sender: 'system' }),
    ]));
  });

  it('handleAgentStatus splices separator before last when within 2s and prev is agent', () => {
    const now = Date.now();
    mockMessageStore.channels = {
      'a1': {
        messages: [
          { type: 'text', text: 'first', sender: 'agent', timestamp: now - 5000 },
          { type: 'text', text: 'second', sender: 'agent', timestamp: now - 100 },
        ],
      },
    };
    const ctx = makeCtx([{ id: 'a1', status: 'idle' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    const msgs = mockMessageStore.setMessages.mock.calls[0][1];
    // Separator inserted before last message (splice)
    expect(msgs[msgs.length - 2]).toEqual(expect.objectContaining({ text: '---', sender: 'system' }));
  });

  it('handleAgentStatus pushes separator when within 2s but prev is system', () => {
    const now = Date.now();
    mockMessageStore.channels = {
      'a1': {
        messages: [
          { type: 'text', text: 'sys', sender: 'system', timestamp: now - 5000 },
          { type: 'text', text: 'last', sender: 'agent', timestamp: now - 100 },
        ],
      },
    };
    const ctx = makeCtx([{ id: 'a1', status: 'idle' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    const msgs = mockMessageStore.setMessages.mock.calls[0][1];
    // Separator pushed at end (not spliced) because prev is system
    expect(msgs[msgs.length - 1]).toEqual(expect.objectContaining({ text: '---', sender: 'system' }));
  });

  it('handleAgentStatus does not insert separator when no messages', () => {
    mockMessageStore.channels = { 'a1': { messages: [] } };
    const ctx = makeCtx([{ id: 'a1', status: 'idle' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    expect(mockMessageStore.setMessages).not.toHaveBeenCalled();
  });

  it('handleAgentStatus does not insert separator when last message is not agent', () => {
    mockMessageStore.channels = {
      'a1': { messages: [{ type: 'text', text: 'sys', sender: 'system' }] },
    };
    const ctx = makeCtx([{ id: 'a1', status: 'idle' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    expect(mockMessageStore.setMessages).not.toHaveBeenCalled();
  });

  it('handleAgentStatus does not insert separator for non-running status', () => {
    const ctx = makeCtx([{ id: 'a1', status: 'running' }]);
    handleAgentStatus({ agentId: 'a1', status: 'idle' } as any, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', { status: 'idle' });
    expect(mockMessageStore.setMessages).not.toHaveBeenCalled();
  });

  it('handleAgentStatus inserts separator on completed→running', () => {
    mockMessageStore.channels = {
      'a1': {
        messages: [{ type: 'text', text: 'done', sender: 'agent', timestamp: Date.now() - 5000 }],
      },
    };
    const ctx = makeCtx([{ id: 'a1', status: 'completed' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    expect(mockMessageStore.setMessages).toHaveBeenCalledWith('a1', expect.arrayContaining([
      expect.objectContaining({ text: '---' }),
    ]));
  });

  it('handleAgentStatus does not insert separator when channel is undefined', () => {
    // channels has no entry for a1 → channel?.messages ?? []
    mockMessageStore.channels = {};
    const ctx = makeCtx([{ id: 'a1', status: 'idle' }]);
    handleAgentStatus({ agentId: 'a1', status: 'running' } as any, ctx);
    expect(mockMessageStore.setMessages).not.toHaveBeenCalled();
  });

  it('handleSpawnError falls back to shortAgentId when agent has no role', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleSpawnError({ agentId: 'a1', message: 'fail' }, ctx);
    expect(mockToastAdd).toHaveBeenCalledWith('error', expect.stringContaining('a1'));
  });

  it('handleSubSpawned defaults to empty childIds when parent has none', () => {
    const ctx = makeCtx([{ id: 'p1' }]);
    handleSubSpawned({ parentId: 'p1', child: { id: 'c1' } } as any, ctx);
    expect(ctx.addAgent).toHaveBeenCalledWith({ id: 'c1' });
    expect(ctx.updateAgent).toHaveBeenCalledWith('p1', { childIds: ['c1'] });
  });

  it('handleSubSpawned appends to existing childIds', () => {
    const ctx = makeCtx([{ id: 'p1', childIds: ['c0'] }]);
    handleSubSpawned({ parentId: 'p1', child: { id: 'c1' } } as any, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('p1', { childIds: ['c0', 'c1'] });
  });
});

// ── Agent Text Handlers ───────────────────────────────────────────

describe('agentTextHandlers', () => {
  it('handleAgentText delegates to messageStore.appendToLastAgentMessage', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentText({ agentId: 'a1', text: ' world' }, ctx);
    expect(mockMessageStore.appendToLastAgentMessage).toHaveBeenCalledWith('a1', ' world');
  });

  it('handleAgentText syncs pendingNewline to messageStore before appending', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    ctx.pendingNewlineRef.current.add('a1');
    handleAgentText({ agentId: 'a1', text: 'first' }, ctx);
    expect(mockMessageStore.setPendingNewline).toHaveBeenCalledWith('a1', true);
    expect(mockMessageStore.appendToLastAgentMessage).toHaveBeenCalledWith('a1', 'first');
    expect(ctx.pendingNewlineRef.current.has('a1')).toBe(false);
  });

  it('handleAgentText normalizes object text', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentText({ agentId: 'a1', text: { text: 'from obj' } }, ctx);
    expect(mockMessageStore.appendToLastAgentMessage).toHaveBeenCalledWith('a1', 'from obj');
  });

  it('handleResponseStart sets pending newline flag', () => {
    const ctx = makeCtx();
    handleResponseStart({ agentId: 'a1' }, ctx);
    expect(ctx.pendingNewlineRef.current.has('a1')).toBe(true);
  });

  it('handleAgentContent pushes content message via messageStore', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentContent({ agentId: 'a1', content: { text: 'img', contentType: 'image', mimeType: 'image/png', data: 'base64' } }, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('a1', expect.objectContaining({
      contentType: 'image', mimeType: 'image/png',
    }));
  });

  it('handleAgentContent includes data, uri, and falls back to empty text', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentContent({ agentId: 'a1', content: { contentType: 'resource', mimeType: 'text/plain', data: 'abc', uri: 'file:///test.txt' } } as any, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('a1', expect.objectContaining({
      text: '',
      contentType: 'resource',
      data: 'abc',
      uri: 'file:///test.txt',
    }));
  });
});

// ── Agent Thinking Handlers ───────────────────────────────────────

describe('agentThinkingHandlers', () => {
  it('handleAgentThinking delegates to messageStore.appendToThinkingMessage', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentThinking({ agentId: 'a1', text: 'reasoning...' }, ctx);
    expect(mockMessageStore.appendToThinkingMessage).toHaveBeenCalledWith('a1', 'reasoning...');
  });

  it('handleAgentThinking normalizes object text', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentThinking({ agentId: 'a1', text: { text: 'thinking obj' } }, ctx);
    expect(mockMessageStore.appendToThinkingMessage).toHaveBeenCalledWith('a1', 'thinking obj');
  });

  it('handleAgentThinking skips empty text', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleAgentThinking({ agentId: 'a1', text: '' }, ctx);
    expect(mockMessageStore.appendToThinkingMessage).not.toHaveBeenCalled();
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
    const ctx = makeCtx([{ id: 'a1', toolCalls: [] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'bash', status: 'running', kind: 'bash' } }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      toolCalls: [expect.objectContaining({ toolCallId: 'tc1' })],
    });
    expect(mockMessageStore.setMessages).toHaveBeenCalledWith('a1',
      [expect.objectContaining({ sender: 'tool' })],
    );
  });

  it('handleToolCall sets pending newline flag', () => {
    const ctx = makeCtx([{ id: 'a1', toolCalls: [] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'test', status: 'running' } }, ctx);
    expect(ctx.pendingNewlineRef.current.has('a1')).toBe(true);
  });

  it('handleToolCall only updates toolCalls when status unchanged', () => {
    const ctx = makeCtx([{ id: 'a1', toolCalls: [{ toolCallId: 'tc1', status: 'running' }] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'test', status: 'running' } }, ctx);
    const call = (ctx.updateAgent as any).mock.calls[0][1];
    expect(call.messages).toBeUndefined();
    expect(mockMessageStore.setMessages).not.toHaveBeenCalled();
  });

  it('handleToolCall updates existing message on status transition to completed', () => {
    mockMessageStore.channels = {
      'a1': {
        messages: [
          { type: 'text', text: '⟳ bash', sender: 'tool', toolCallId: 'tc1', toolStatus: 'running' },
        ],
      },
    };
    const ctx = makeCtx([{ id: 'a1', toolCalls: [{ toolCallId: 'tc1', status: 'running', title: 'bash' }] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'bash', status: 'completed', kind: 'bash' } }, ctx);
    expect(mockMessageStore.setMessages).toHaveBeenCalledWith('a1',
      expect.arrayContaining([
        expect.objectContaining({ text: '✓ bash', toolStatus: 'completed' }),
      ]),
    );
  });

  it('handleToolCall shows cancelled icon on status transition', () => {
    mockMessageStore.channels = {
      'a1': {
        messages: [
          { type: 'text', text: '⟳ run', sender: 'tool', toolCallId: 'tc1', toolStatus: 'running' },
        ],
      },
    };
    const ctx = makeCtx([{ id: 'a1', toolCalls: [{ toolCallId: 'tc1', status: 'running', title: 'run' }] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'run', status: 'cancelled' } }, ctx);
    expect(mockMessageStore.setMessages).toHaveBeenCalledWith('a1',
      expect.arrayContaining([
        expect.objectContaining({ text: '✗ run' }),
      ]),
    );
  });

  it('handleToolCall coerces non-string title', () => {
    const ctx = makeCtx([{ id: 'a1', toolCalls: [] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc2', title: 42 as any, status: 'running' } }, ctx);
    expect(mockMessageStore.setMessages).toHaveBeenCalledWith('a1',
      expect.arrayContaining([
        expect.objectContaining({ text: '⟳ 42' }),
      ]),
    );
  });

  it('handleToolCall defaults to empty toolCalls when agent has none', () => {
    const ctx = makeCtx([{ id: 'a1' }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'bash', status: 'running' } }, ctx);
    expect(ctx.updateAgent).toHaveBeenCalledWith('a1', {
      toolCalls: [expect.objectContaining({ toolCallId: 'tc1' })],
    });
  });
  it('handleToolCall updates in-place among multiple tool calls', () => {
    mockMessageStore.channels = {
      'a1': {
        messages: [
          { type: 'text', text: '⟳ first', sender: 'tool', toolCallId: 'tc1', toolStatus: 'running' },
          { type: 'text', text: '⟳ second', sender: 'tool', toolCallId: 'tc2', toolStatus: 'running' },
        ],
      },
    };
    const ctx = makeCtx([{ id: 'a1', toolCalls: [
      { toolCallId: 'tc1', status: 'running', title: 'first' },
      { toolCallId: 'tc2', status: 'running', title: 'second' },
    ] }]);
    handleToolCall({ agentId: 'a1', toolCall: { toolCallId: 'tc1', title: 'first', status: 'completed' } }, ctx);
    const updated = (ctx.updateAgent as any).mock.calls[0][1].toolCalls;
    expect(updated[0]).toEqual(expect.objectContaining({ toolCallId: 'tc1', status: 'completed' }));
    expect(updated[1]).toEqual(expect.objectContaining({ toolCallId: 'tc2', status: 'running' }));
  });
});

// ── Messaging Handlers ────────────────────────────────────────────

describe('messagingHandlers', () => {
  it('handleMessageSent shows in recipient panel via messageStore', () => {
    const ctx = makeCtx([
      { id: 'from1', role: { name: 'Dev' } },
      { id: 'to1' },
    ]);
    handleMessageSent({ from: 'from1', to: 'to1', fromRole: 'Dev', content: 'hello' }, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('to1',
      expect.objectContaining({ text: expect.stringContaining('📨') }),
    );
  });

  it('handleMessageSent shows in sender panel via messageStore', () => {
    const ctx = makeCtx([
      { id: 'from1', role: { name: 'Dev' } },
      { id: 'to1', role: { name: 'Arch' } },
    ]);
    handleMessageSent({ from: 'from1', to: 'to1', content: 'hello' }, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('from1',
      expect.objectContaining({ text: expect.stringContaining('📤') }),
    );
  });

  it('handleMessageSent from system uses system sender', () => {
    const ctx = makeCtx([{ id: 'to1' }]);
    handleMessageSent({ from: 'system', to: 'to1', content: 'info' }, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('to1',
      expect.objectContaining({ sender: 'system', text: expect.stringContaining('⚙️') }),
    );
  });

  it('handleMessageSent shows broadcast label when to is all', () => {
    const ctx = makeCtx([{ id: 'from1', role: { name: 'Lead' } }]);
    handleMessageSent({ from: 'from1', to: 'all', content: 'hey everyone' }, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('from1',
      expect.objectContaining({ text: expect.stringContaining('All') }),
    );
  });

  it('handleMessageSent uses shortAgentId when recipient has no role', () => {
    const ctx = makeCtx([
      { id: 'from1', role: { name: 'Dev' } },
      { id: 'to1' },
    ]);
    handleMessageSent({ from: 'from1', to: 'to1', content: 'hi' }, ctx);
    // sender panel label falls back to shortAgentId
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('from1',
      expect.objectContaining({ text: expect.stringContaining('📤') }),
    );
  });

  it('handleMessageSent from system only adds to recipient panel', () => {
    const ctx = makeCtx([{ id: 'to1' }]);
    handleMessageSent({ from: 'system', to: 'to1', content: 'note' }, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledTimes(1);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('to1', expect.any(Object));
  });
  it('handleMessageSent skips recipient panel when to is system', () => {
    const ctx = makeCtx([{ id: 'from1', role: { name: 'Dev' } }]);
    handleMessageSent({ from: 'from1', to: 'system', content: 'msg' }, ctx);
    // Only sender panel gets a message, not the 'system' channel
    expect(mockMessageStore.addMessage).toHaveBeenCalledTimes(1);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('from1', expect.objectContaining({ text: expect.stringContaining('📤') }));
  });

  it('handleMessageSent uses System label when fromId is empty', () => {
    const ctx = makeCtx([{ id: 'to1' }]);
    handleMessageSent({ from: '', to: 'to1', content: 'hi' } as any, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('to1',
      expect.objectContaining({ text: expect.stringContaining('System') }),
    );
  });

  it('handleMessageSent handles undefined content', () => {
    const ctx = makeCtx([{ id: 'to1' }]);
    handleMessageSent({ from: 'system', to: 'to1' } as any, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('to1', expect.objectContaining({ sender: 'system' }));
  });

  it('handleMessageSent with fromRole and null fromId', () => {
    const ctx = makeCtx([{ id: 'to1' }]);
    handleMessageSent({ from: null as any, to: 'to1', fromRole: 'Admin', content: 'x' } as any, ctx);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('to1',
      expect.objectContaining({ text: expect.stringContaining('Admin') }),
    );
  });

  it('handleMessageSent sender panel with toId null skips recipient', () => {
    const ctx = makeCtx([{ id: 'from1', role: { name: 'Dev' } }]);
    handleMessageSent({ from: 'from1', to: null as any, content: 'x' } as any, ctx);
    // recipient panel skipped (toId is falsy), but sender panel still runs
    expect(mockMessageStore.addMessage).toHaveBeenCalledTimes(1);
    expect(mockMessageStore.addMessage).toHaveBeenCalledWith('from1', expect.objectContaining({ text: expect.stringContaining('📤') }));
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

  it('handleGroupMessage does nothing when message field is missing', () => {
    handleGroupMessage({} as any);
    expect(mockGroupStore.addMessage).not.toHaveBeenCalled();
  });

  it('handleGroupMessage passes through fromAgentId', () => {
    handleGroupMessage({ message: { leadId: 'l1', groupName: 'team', text: 'hi', fromAgentId: 'a1' } });
    expect(mockGroupStore.addMessage).toHaveBeenCalledWith('l1:team', expect.objectContaining({ fromAgentId: 'a1' }));
  });

  it('handleGroupMemberAdded does nothing when group is missing', () => {
    handleGroupMemberAdded({ leadId: 'l1', agentId: 'a1' } as any);
    expect(mockGroupStore.addMember).not.toHaveBeenCalled();
  });

  it('handleGroupMemberRemoved does nothing when agentId is missing', () => {
    handleGroupMemberRemoved({ leadId: 'l1', group: 'team' } as any);
    expect(mockGroupStore.removeMember).not.toHaveBeenCalled();
  });

  it('handleGroupReaction does nothing when required fields are missing', () => {
    handleGroupReaction({ leadId: 'l1', groupName: 'team' } as any);
    expect(mockGroupStore.addReaction).not.toHaveBeenCalled();
    expect(mockGroupStore.removeReaction).not.toHaveBeenCalled();
  });

  it('handleGroupCreated defaults memberIds and createdAt', () => {
    handleGroupCreated({ name: 'chat', leadId: 'l1' } as any);
    expect(mockGroupStore.addGroup).toHaveBeenCalledWith(expect.objectContaining({
      name: 'chat',
      memberIds: [],
    }));
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

  it('handleTimerCreated does nothing when timer is missing', () => {
    handleTimerCreated({} as any);
    expect(mockTimerStore.addTimer).not.toHaveBeenCalled();
  });

  it('handleTimerFired does nothing when no id available', () => {
    handleTimerFired({} as any);
    expect(mockTimerStore.fireTimer).not.toHaveBeenCalled();
  });

  it('handleTimerCancelled uses timer.id fallback', () => {
    handleTimerCancelled({ timer: { id: 't3' } } as any);
    expect(mockTimerStore.removeTimer).toHaveBeenCalledWith('t3');
  });

  it('handleTimerCancelled does nothing when no id available', () => {
    handleTimerCancelled({} as any);
    expect(mockTimerStore.removeTimer).not.toHaveBeenCalled();
  });

  it('handleLeadDecision does nothing when needsConfirmation is false', () => {
    const ctx = makeCtx();
    handleLeadDecision({ needsConfirmation: false, id: 'd1' } as any, ctx);
    expect(ctx.getAppState().addPendingDecision).not.toHaveBeenCalled();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('handleLeadDecision does nothing when id is missing', () => {
    const ctx = makeCtx();
    handleLeadDecision({ needsConfirmation: true } as any, ctx);
    expect(ctx.getAppState().addPendingDecision).not.toHaveBeenCalled();
  });

  it('handleDecisionsBatch skips decisions without id', () => {
    const ctx = makeCtx();
    handleDecisionsBatch({ decisions: [{ id: 'd1' }, {} as any, { id: 'd2' }] }, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledTimes(2);
  });

  it('handleDecisionsBatch handles undefined decisions', () => {
    const ctx = makeCtx();
    handleDecisionsBatch({} as any, ctx);
    expect(ctx.getAppState().removePendingDecision).not.toHaveBeenCalled();
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

  it('handleLeadDecision populates default fields when optional fields missing', () => {
    const ctx = makeCtx();
    handleLeadDecision({ needsConfirmation: true, id: 'd1', agentId: 'a1' } as any, ctx);
    expect(ctx.getAppState().addPendingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRole: 'Unknown',
        title: 'Untitled decision',
        rationale: '',
        status: 'recorded',
        autoApproved: false,
        confirmedAt: null,
      }),
    );
  });

  it('handleDecisionResolved removes decision', () => {
    const ctx = makeCtx();
    handleDecisionResolved({ decisionId: 'd1' }, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d1');
  });

  it('handleDecisionResolved extracts id from flat id field', () => {
    const ctx = makeCtx();
    handleDecisionResolved({ id: 'd5' } as any, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d5');
  });

  it('handleDecisionResolved extracts from nested decision.decisionId', () => {
    const ctx = makeCtx();
    handleDecisionResolved({ decision: { decisionId: 'd6' } } as any, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d6');
  });

  it('handleDecisionResolved extracts from nested decision.id', () => {
    const ctx = makeCtx();
    handleDecisionResolved({ decision: { id: 'd7' } } as any, ctx);
    expect(ctx.getAppState().removePendingDecision).toHaveBeenCalledWith('d7');
  });

  it('handleDecisionResolved does nothing when no id found', () => {
    const ctx = makeCtx();
    handleDecisionResolved({} as any, ctx);
    expect(ctx.getAppState().removePendingDecision).not.toHaveBeenCalled();
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
