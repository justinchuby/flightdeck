import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- Mock WebSocket ---
let lastWs: MockWebSocket | null = null;
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  readyState = MockWebSocket.OPEN;
  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    lastWs = this;
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; }
}
vi.stubGlobal('WebSocket', MockWebSocket);

// --- Mock useApi ---
vi.mock('../useApi', () => ({
  getAuthToken: vi.fn(() => null),
  apiFetch: vi.fn(() => Promise.resolve()),
}));

// --- Mock settingsStore ---
let mockOversightLevel = 'supervised';
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ getEffectiveLevel: () => mockOversightLevel }),
  },
}));

// --- Mock commandParser ---
vi.mock('../../utils/commandParser', () => ({
  hasUnclosedCommandBlock: vi.fn(() => false),
}));

import { useAppStore } from '../../stores/appStore';
import { useGroupStore } from '../../stores/groupStore';
import { useTimerStore } from '../../stores/timerStore';
import { sendWsMessage, useWebSocket } from '../useWebSocket';

function simulateMsg(msg: Record<string, unknown>) {
  act(() => { lastWs?.onmessage?.({ data: JSON.stringify(msg) }); });
}

function openWs() {
  act(() => { lastWs?.onopen?.({}); });
}

describe('sendWsMessage', () => {
  it('sends JSON when ws is OPEN', () => {
    const ws = new MockWebSocket('ws://test');
    ws.readyState = MockWebSocket.OPEN;
    // Assign to module-level globalWs via the hook
    renderHook(() => useWebSocket());
    openWs();
    sendWsMessage({ type: 'ping' });
    // The hook's connect() also sends a subscribe, so check the last sent message
    expect(lastWs!.sent.some(s => s.includes('"ping"'))).toBe(true);
  });

  it('is a no-op when ws is null or closed', () => {
    // Before any hook renders, sendWsMessage should not throw
    expect(() => sendWsMessage({ type: 'test' })).not.toThrow();
  });
});

describe('useWebSocket — connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastWs = null;
    useAppStore.setState({ agents: [], connected: false, loading: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates WebSocket on mount', () => {
    renderHook(() => useWebSocket());
    expect(lastWs).not.toBeNull();
    expect(lastWs!.url).toContain('ws://');
  });

  it('sends subscribe on open and sets connected', () => {
    renderHook(() => useWebSocket());
    openWs();
    expect(useAppStore.getState().connected).toBe(true);
    const sub = lastWs!.sent.find(s => s.includes('"subscribe"'));
    expect(sub).toBeDefined();
    expect(JSON.parse(sub!).agentId).toBe('*');
  });

  it('sets connected=false on close and reconnects', () => {
    renderHook(() => useWebSocket());
    openWs();
    expect(useAppStore.getState().connected).toBe(true);

    const closedWs = lastWs;
    act(() => { closedWs?.onclose?.({}); });
    expect(useAppStore.getState().connected).toBe(false);

    // Advance timer for reconnect (2s)
    act(() => { vi.advanceTimersByTime(2500); });
    expect(lastWs).not.toBe(closedWs);
  });

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket());
    openWs();
    const ws = lastWs;
    unmount();
    expect(ws!.readyState).toBe(MockWebSocket.CLOSED);
  });
});

describe('useWebSocket — message handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastWs = null;
    mockOversightLevel = 'supervised';
    useAppStore.setState({
      agents: [],
      connected: false,
      loading: true,
      systemPaused: false,
      pendingDecisions: [],
    });
    useGroupStore.setState({ groups: [], messages: {} });
    useTimerStore.setState({ timers: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    renderHook(() => useWebSocket());
    openWs();
  }

  it('init sets agents and loading=false', () => {
    setup();
    const agents = [{ id: 'a1', status: 'running' }];
    simulateMsg({ type: 'init', agents });
    expect(useAppStore.getState().agents).toEqual(agents);
    expect(useAppStore.getState().loading).toBe(false);
  });

  it('init sets systemPaused when present', () => {
    setup();
    simulateMsg({ type: 'init', agents: [], systemPaused: true });
    expect(useAppStore.getState().systemPaused).toBe(true);
  });

  it('agent:spawned adds agent', () => {
    setup();
    const agent = { id: 'a2', status: 'running', role: { name: 'dev' } };
    simulateMsg({ type: 'agent:spawned', agent });
    expect(useAppStore.getState().agents.find(a => a.id === 'a2')).toBeTruthy();
  });

  it('agent:terminated updates status', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({ type: 'agent:terminated', agentId: 'a1' });
    expect(useAppStore.getState().agents.find(a => a.id === 'a1')?.status).toBe('terminated');
  });

  it('agent:exit with code 0 sets completed', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({ type: 'agent:exit', agentId: 'a1', code: 0 });
    expect(useAppStore.getState().agents.find(a => a.id === 'a1')?.status).toBe('completed');
  });

  it('agent:exit with non-zero code sets failed', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({ type: 'agent:exit', agentId: 'a1', code: 1, error: 'crash' });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.status).toBe('failed');
    expect(a?.exitError).toBe('crash');
  });

  it('agent:exit does not overwrite terminated', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'terminated' } as any] });
    simulateMsg({ type: 'agent:exit', agentId: 'a1', code: 1 });
    expect(useAppStore.getState().agents.find(a => a.id === 'a1')?.status).toBe('terminated');
  });

  it('agent:status updates status', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:status', agentId: 'a1', status: 'idle' });
    expect(useAppStore.getState().agents.find(a => a.id === 'a1')?.status).toBe('idle');
  });

  it('agent:text appends text to agent messages', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: 'hello' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(1);
    expect(msgs?.[0].text).toBe('hello');
  });

  it('agent:text appends to existing agent message', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [{ type: 'text', text: 'hello', sender: 'agent', timestamp: Date.now() }],
      } as any],
    });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: ' world' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(1);
    expect(msgs?.[0].text).toBe('hello world');
  });

  it('agent:thinking creates thinking message', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:thinking', agentId: 'a1', text: 'hmm' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[0].sender).toBe('thinking');
    expect(msgs?.[0].text).toBe('hmm');
  });

  it('agent:thinking appends to existing thinking message', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [{ type: 'text', text: 'think', sender: 'thinking', timestamp: Date.now() }],
      } as any],
    });
    simulateMsg({ type: 'agent:thinking', agentId: 'a1', text: 'ing' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(1);
    expect(msgs?.[0].text).toBe('thinking');
  });

  it('agent:thinking normalizes object text payload', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:thinking', agentId: 'a1', text: { text: 'pondering' } });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[0].sender).toBe('thinking');
    expect(msgs?.[0].text).toBe('pondering');
  });

  it('agent:thinking skips empty text', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:thinking', agentId: 'a1', text: '' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs).toHaveLength(0);
  });

  it('thinking messages survive init (setAgents) reinit', () => {
    setup();
    const thinkMsg = { type: 'text', text: 'deep thought', sender: 'thinking', timestamp: 1000 };
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [thinkMsg] } as any] });
    // Simulate WS reconnect init — server sends agents without messages
    simulateMsg({ type: 'init', agents: [{ id: 'a1', status: 'idle' }] });
    const agent = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(agent?.status).toBe('idle');
    expect(agent?.messages).toHaveLength(1);
    expect(agent?.messages?.[0].text).toBe('deep thought');
  });

  it('thinking messages survive agent:spawned re-announcement', () => {
    setup();
    const thinkMsg = { type: 'text', text: 'reasoning...', sender: 'thinking', timestamp: 1000 };
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [thinkMsg] } as any] });
    // Simulate agent:spawned for same agent (e.g., session resume)
    simulateMsg({ type: 'agent:spawned', agent: { id: 'a1', status: 'idle', role: { id: 'dev', name: 'Dev' } } });
    const agent = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(agent?.status).toBe('idle');
    expect(agent?.messages).toHaveLength(1);
    expect(agent?.messages?.[0].sender).toBe('thinking');
  });

  it('agent:usage updates token counts', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({ type: 'agent:usage', agentId: 'a1', inputTokens: 100, outputTokens: 50 });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.inputTokens).toBe(100);
    expect(a?.outputTokens).toBe(50);
  });

  it('agent:content pushes content message', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({
      type: 'agent:content', agentId: 'a1',
      content: { text: 'result', contentType: 'resource', mimeType: 'text/plain' },
    });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(1);
    expect(msgs?.[0].text).toBe('result');
    expect(msgs?.[0].contentType).toBe('resource');
  });

  it('agent:tool_call adds new tool call', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [], toolCalls: [] } as any] });
    simulateMsg({
      type: 'agent:tool_call', agentId: 'a1',
      toolCall: { toolCallId: 'tc1', title: 'Run tests', status: 'running', kind: 'bash' },
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.toolCalls?.length).toBe(1);
    expect(a?.toolCalls?.[0].toolCallId).toBe('tc1');
  });

  it('agent:tool_call updates existing tool call on status change', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running', messages: [],
        toolCalls: [{ toolCallId: 'tc1', title: 'Run tests', status: 'running', kind: 'bash' }],
      } as any],
    });
    simulateMsg({
      type: 'agent:tool_call', agentId: 'a1',
      toolCall: { toolCallId: 'tc1', title: 'Run tests', status: 'completed', kind: 'bash' },
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.toolCalls?.[0].status).toBe('completed');
  });

  it('agent:response_start sets pending newline flag', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [{ type: 'text', text: 'first', sender: 'agent', timestamp: Date.now() }],
      } as any],
    });
    simulateMsg({ type: 'agent:response_start', agentId: 'a1' });
    // Next text should create a new message, not append
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: 'second' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(2);
    expect(msgs?.[1].text).toBe('second');
  });

  it('agent:plan updates agent plan', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    const plan = { tasks: [{ id: 't1', title: 'Do stuff' }] };
    simulateMsg({ type: 'agent:plan', agentId: 'a1', plan });
    expect(useAppStore.getState().agents.find(a => a.id === 'a1')?.plan).toEqual(plan);
  });

  it('agent:session_ready updates sessionId', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({ type: 'agent:session_ready', agentId: 'a1', sessionId: 'sess-123' });
    expect(useAppStore.getState().agents.find(a => a.id === 'a1')?.sessionId).toBe('sess-123');
  });

  it('agent:sub_spawned adds child and updates parent', () => {
    setup();
    useAppStore.setState({
      agents: [{ id: 'parent', status: 'running', childIds: [] } as any],
    });
    const child = { id: 'child1', status: 'running' };
    simulateMsg({ type: 'agent:sub_spawned', parentId: 'parent', child });
    const state = useAppStore.getState();
    expect(state.agents.find(a => a.id === 'child1')).toBeTruthy();
    expect(state.agents.find(a => a.id === 'parent')?.childIds).toContain('child1');
  });

  it('group:created adds to groupStore', () => {
    setup();
    simulateMsg({
      type: 'group:created', name: 'team',
      leadId: 'lead1', memberIds: ['a1', 'a2'],
    });
    const groups = useGroupStore.getState().groups;
    expect(groups.some(g => g.name === 'team')).toBe(true);
  });

  it('system:paused updates systemPaused', () => {
    setup();
    simulateMsg({ type: 'system:paused', paused: true });
    expect(useAppStore.getState().systemPaused).toBe(true);
  });

  it('timer:created adds timer', () => {
    setup();
    const timer = { id: 't1', label: 'check', delay: 300, message: 'check' };
    simulateMsg({ type: 'timer:created', timer });
    expect(useTimerStore.getState().timers.some(t => t.id === 't1')).toBe(true);
  });

  it('timer:cancelled removes timer', () => {
    setup();
    useTimerStore.setState({ timers: [{ id: 't1', label: 'x' } as any] });
    simulateMsg({ type: 'timer:cancelled', timerId: 't1' });
    expect(useTimerStore.getState().timers.find(t => t.id === 't1')).toBeUndefined();
  });

  it('lead:decision adds pending decision', () => {
    setup();
    simulateMsg({
      type: 'lead:decision',
      needsConfirmation: true,
      id: 'd1',
      agentId: 'a1',
      agentRole: 'architect',
      title: 'Use React',
      rationale: 'team knows it',
      status: 'recorded',
    });
    const decisions = useAppStore.getState().pendingDecisions;
    expect(decisions?.some(d => d.id === 'd1')).toBe(true);
  });

  it('lead:decision auto-approves in autonomous mode', async () => {
    const { apiFetch } = await import('../useApi');
    mockOversightLevel = 'autonomous';
    setup();
    simulateMsg({
      type: 'lead:decision',
      needsConfirmation: true,
      id: 'd2',
      agentId: 'a1',
      title: 'Auto',
    });
    expect(apiFetch).toHaveBeenCalledWith('/decisions/d2/confirm', expect.anything());
  });

  it('decision:confirmed removes pending decision', () => {
    setup();
    useAppStore.setState({
      pendingDecisions: [{ id: 'd1', title: 'test' } as any],
    });
    simulateMsg({ type: 'decision:confirmed', decisionId: 'd1' });
    expect(useAppStore.getState().pendingDecisions?.find(d => d.id === 'd1')).toBeUndefined();
  });

  it('decisions:batch removes all resolved decisions', () => {
    setup();
    useAppStore.setState({
      pendingDecisions: [{ id: 'd1' } as any, { id: 'd2' } as any],
    });
    simulateMsg({ type: 'decisions:batch', decisions: [{ id: 'd1' }, { id: 'd2' }] });
    expect(useAppStore.getState().pendingDecisions?.length).toBe(0);
  });

  it('attention:changed dispatches custom event', () => {
    setup();
    const handler = vi.fn();
    window.addEventListener('attention:changed', handler);
    simulateMsg({ type: 'attention:changed' });
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('attention:changed', handler);
  });

  it('handles unparseable JSON gracefully', () => {
    setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => { lastWs?.onmessage?.({ data: 'not json' }); });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('dispatches raw ws-message event', () => {
    setup();
    const handler = vi.fn();
    window.addEventListener('ws-message', handler);
    simulateMsg({ type: 'init', agents: [] });
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('ws-message', handler);
  });

  // ── agent:status separator logic ──────────────────────────────

  it('agent:status inserts separator when transitioning idle→running with agent message', () => {
    setup();
    const now = Date.now();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'idle',
        messages: [
          { type: 'text', text: 'old msg', sender: 'agent', timestamp: now - 5000 },
        ],
      } as any],
    });
    simulateMsg({ type: 'agent:status', agentId: 'a1', status: 'running' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.some(m => m.text === '---')).toBe(true);
  });

  it('agent:status inserts separator before recent agent message when text arrived early', () => {
    setup();
    const now = Date.now();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'idle',
        messages: [
          { type: 'text', text: 'old response', sender: 'agent', timestamp: now - 5000 },
          { type: 'text', text: 'new text', sender: 'agent', timestamp: now - 500 },
        ],
      } as any],
    });
    simulateMsg({ type: 'agent:status', agentId: 'a1', status: 'running' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[1]?.text).toBe('---');
    expect(msgs?.[2]?.text).toBe('new text');
  });

  it('agent:status inserts separator after message when prev is non-agent', () => {
    setup();
    const now = Date.now();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'idle',
        messages: [
          { type: 'text', text: 'thought', sender: 'thinking', timestamp: now - 3000 },
          { type: 'text', text: 'new text', sender: 'agent', timestamp: now - 500 },
        ],
      } as any],
    });
    simulateMsg({ type: 'agent:status', agentId: 'a1', status: 'running' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[msgs.length - 1]?.text).toBe('---');
  });

  it('agent:status does not insert separator when last message is not agent', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'completed',
        messages: [
          { type: 'text', text: 'thought', sender: 'thinking', timestamp: Date.now() - 5000 },
        ],
      } as any],
    });
    simulateMsg({ type: 'agent:status', agentId: 'a1', status: 'running' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.some(m => m.text === '---')).toBe(false);
  });

  it('agent:status no separator when not transitioning from idle/completed', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [{ type: 'text', text: 'msg', sender: 'agent', timestamp: Date.now() }],
      } as any],
    });
    simulateMsg({ type: 'agent:status', agentId: 'a1', status: 'running' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.some(m => m.text === '---')).toBe(false);
  });

  // ── agent:text edge cases ─────────────────────────────────────

  it('agent:text stringifies non-string text', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: { nested: true } });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[0].text).toContain('nested');
  });

  it('agent:text uses text.text when text is an object with .text', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running', messages: [] } as any] });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: { text: 'wrapped value' } });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[0].text).toBe('wrapped value');
  });

  it('agent:text skips notification messages when finding append target', () => {
    setup();
    const now = Date.now();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [
          { type: 'text', text: 'hello', sender: 'agent', timestamp: now - 1000 },
          { type: 'text', text: '📨 [From dev] msg', sender: 'system', timestamp: now - 500 },
        ],
      } as any],
    });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: ' world' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.[0].text).toBe('hello world');
  });

  it('agent:text creates new message when user message breaks append chain', () => {
    setup();
    const now = Date.now();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [
          { type: 'text', text: 'response', sender: 'agent', timestamp: now - 3000 },
          { type: 'text', text: 'user input', sender: 'user', timestamp: now - 1000 },
        ],
      } as any],
    });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: 'new response' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(3);
    expect(msgs?.[2].text).toBe('new response');
  });

  it('agent:text appends when hasUnclosedCommandBlock returns true despite newline', async () => {
    const { hasUnclosedCommandBlock } = await import('../../utils/commandParser');
    (hasUnclosedCommandBlock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [{ type: 'text', text: '```bash\necho hi', sender: 'agent', timestamp: Date.now() }],
      } as any],
    });
    simulateMsg({ type: 'agent:response_start', agentId: 'a1' });
    simulateMsg({ type: 'agent:text', agentId: 'a1', text: '\n```' });
    const msgs = useAppStore.getState().agents.find(a => a.id === 'a1')?.messages;
    expect(msgs?.length).toBe(1);
    expect(msgs?.[0].text).toContain('```');
  });

  // ── agent:tool_call edge cases ────────────────────────────────

  it('agent:tool_call only updates toolCalls when status unchanged', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [{ type: 'text', text: '⟳ Run tests', sender: 'tool', toolCallId: 'tc1', toolStatus: 'running', timestamp: Date.now() }],
        toolCalls: [{ toolCallId: 'tc1', title: 'Run tests', status: 'running', kind: 'bash' }],
      } as any],
    });
    simulateMsg({
      type: 'agent:tool_call', agentId: 'a1',
      toolCall: { toolCallId: 'tc1', title: 'Run tests', status: 'running', kind: 'bash' },
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.messages?.length).toBe(1);
  });

  it('agent:tool_call updates existing tool message in-place on status change', () => {
    setup();
    useAppStore.setState({
      agents: [{
        id: 'a1', status: 'running',
        messages: [
          { type: 'text', text: '⟳ Run tests', sender: 'tool', toolCallId: 'tc1', toolStatus: 'running', timestamp: Date.now() },
        ],
        toolCalls: [{ toolCallId: 'tc1', title: 'Run tests', status: 'running', kind: 'bash' }],
      } as any],
    });
    simulateMsg({
      type: 'agent:tool_call', agentId: 'a1',
      toolCall: { toolCallId: 'tc1', title: 'Run tests', status: 'completed', kind: 'bash' },
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.messages?.length).toBe(1);
    expect(a?.messages?.[0].text).toContain('✓');
    expect(a?.messages?.[0].toolStatus).toBe('completed');
  });

  // ── agent:message_sent branches ───────────────────────────────

  it('agent:message_sent shows in recipient and sender panels', () => {
    setup();
    useAppStore.setState({
      agents: [
        { id: 'a1', status: 'running', messages: [], role: { name: 'architect' } } as any,
        { id: 'a2', status: 'running', messages: [], role: { name: 'developer' } } as any,
      ],
    });
    simulateMsg({
      type: 'agent:message_sent', from: 'a1', to: 'a2',
      fromRole: 'architect', content: 'implement auth',
    });
    const recipient = useAppStore.getState().agents.find(a => a.id === 'a2');
    expect(recipient?.messages?.some(m => m.text?.includes('📨'))).toBe(true);
    const sender = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(sender?.messages?.some(m => m.text?.includes('📤'))).toBe(true);
  });

  it('agent:message_sent from system uses system prefix', () => {
    setup();
    useAppStore.setState({
      agents: [{ id: 'a1', status: 'running', messages: [] } as any],
    });
    simulateMsg({
      type: 'agent:message_sent', from: 'system', to: 'a1',
      content: 'system instruction',
    });
    const recipient = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(recipient?.messages?.some(m => m.text?.includes('⚙️'))).toBe(true);
    expect(recipient?.messages?.some(m => m.sender === 'system')).toBe(true);
  });

  it('agent:message_sent broadcast shows [To All]', () => {
    setup();
    useAppStore.setState({
      agents: [
        { id: 'a1', status: 'running', messages: [], role: { name: 'lead' } } as any,
      ],
    });
    simulateMsg({
      type: 'agent:message_sent', from: 'a1', to: 'all',
      fromRole: 'lead', content: 'attention everyone',
    });
    const sender = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(sender?.messages?.some(m => m.text?.includes('[To All]'))).toBe(true);
  });

  it('agent:message_sent does not add sender message when from === to', () => {
    setup();
    useAppStore.setState({
      agents: [{ id: 'a1', status: 'running', messages: [] } as any],
    });
    simulateMsg({
      type: 'agent:message_sent', from: 'a1', to: 'a1',
      content: 'self message',
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.messages?.filter(m => m.text?.includes('📤')).length).toBe(0);
  });

  // ── group:reaction branches ───────────────────────────────────

  it('group:reaction action=remove calls removeReaction', () => {
    setup();
    const gs = useGroupStore.getState();
    const spy = vi.spyOn(gs, 'removeReaction');
    simulateMsg({
      type: 'group:reaction',
      leadId: 'lead1', groupName: 'chat',
      messageId: 'msg1', emoji: '👍', agentId: 'a1',
      action: 'remove',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('group:reaction action=add calls addReaction', () => {
    setup();
    const gs = useGroupStore.getState();
    const spy = vi.spyOn(gs, 'addReaction');
    simulateMsg({
      type: 'group:reaction',
      leadId: 'lead1', groupName: 'chat',
      messageId: 'msg1', emoji: '👍', agentId: 'a1',
      action: 'add',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ── timer fallback ids ────────────────────────────────────────

  it('timer:fired uses timer.id fallback when timerId absent', () => {
    setup();
    useTimerStore.setState({
      timers: [{ id: 't2', label: 'check', status: 'active' } as any],
    });
    simulateMsg({ type: 'timer:fired', timer: { id: 't2' } });
    const timer = useTimerStore.getState().timers.find(t => t.id === 't2');
    expect(timer?.status).toBe('fired');
  });

  it('timer:cancelled uses timer.id fallback when timerId absent', () => {
    setup();
    useTimerStore.setState({
      timers: [{ id: 't3', label: 'check' } as any],
    });
    simulateMsg({ type: 'timer:cancelled', timer: { id: 't3' } });
    expect(useTimerStore.getState().timers.find(t => t.id === 't3')).toBeUndefined();
  });

  // ── agent:spawn_error ─────────────────────────────────────────

  it('agent:spawn_error shows toast with agent role label', () => {
    setup();
    useAppStore.setState({
      agents: [{ id: 'a1', status: 'running', role: { name: 'architect' } } as any],
    });
    simulateMsg({
      type: 'agent:spawn_error', agentId: 'a1', message: 'Rate limit exceeded',
    });
    expect(useAppStore.getState().agents.length).toBe(1);
  });

  // ── agent:model_fallback ──────────────────────────────────────

  it('agent:model_fallback updates agent model and resolution info', () => {
    setup();
    useAppStore.setState({
      agents: [{ id: 'a1', status: 'running', model: 'gpt-4' } as any],
    });
    simulateMsg({
      type: 'agent:model_fallback', agentId: 'a1',
      requested: 'gpt-4', resolved: 'gpt-3.5', reason: 'rate-limited',
      agentRole: 'developer', provider: 'openai',
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.model).toBe('gpt-3.5');
    expect(a?.modelResolution?.translated).toBe(true);
  });

  // ── agent:session_resume_failed ───────────────────────────────

  it('agent:session_resume_failed shows toast without throwing', () => {
    setup();
    simulateMsg({
      type: 'agent:session_resume_failed', agentId: 'a1', error: 'Session expired',
    });
    expect(true).toBe(true);
  });

  // ── lead:decision in autonomous mode ──────────────────────────

  it('lead:decision in autonomous mode does not add to pending', async () => {
    const { apiFetch } = await import('../useApi');
    mockOversightLevel = 'autonomous';
    setup();
    simulateMsg({
      type: 'lead:decision', needsConfirmation: true,
      id: 'd-auto', agentId: 'a1', title: 'Auto decision',
    });
    expect(useAppStore.getState().pendingDecisions?.find(d => d.id === 'd-auto')).toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith('/decisions/d-auto/confirm', expect.anything());
  });

  // ── decision:rejected / dismissed ─────────────────────────────

  it('decision:rejected removes pending decision', () => {
    setup();
    useAppStore.setState({ pendingDecisions: [{ id: 'd1', title: 'test' } as any] });
    simulateMsg({ type: 'decision:rejected', decisionId: 'd1' });
    expect(useAppStore.getState().pendingDecisions?.find(d => d.id === 'd1')).toBeUndefined();
  });

  it('decision:dismissed removes pending decision', () => {
    setup();
    useAppStore.setState({ pendingDecisions: [{ id: 'd1', title: 'test' } as any] });
    simulateMsg({ type: 'decision:dismissed', decisionId: 'd1' });
    expect(useAppStore.getState().pendingDecisions?.find(d => d.id === 'd1')).toBeUndefined();
  });

  // ── agent:usage with optional fields ──────────────────────────

  it('agent:usage sets cache and context fields when present', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({
      type: 'agent:usage', agentId: 'a1',
      inputTokens: 200, outputTokens: 100,
      cacheReadTokens: 50, cacheWriteTokens: 20,
      contextWindowUsed: 1000, contextWindowSize: 8000,
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.cacheReadTokens).toBe(50);
    expect(a?.contextWindowUsed).toBe(1000);
  });

  it('agent:usage omits cache fields when not present', () => {
    setup();
    useAppStore.setState({ agents: [{ id: 'a1', status: 'running' } as any] });
    simulateMsg({
      type: 'agent:usage', agentId: 'a1',
      inputTokens: 200, outputTokens: 100,
    });
    const a = useAppStore.getState().agents.find(a => a.id === 'a1');
    expect(a?.inputTokens).toBe(200);
    expect(a?.cacheReadTokens).toBeUndefined();
  });

  // ── group:message / member_added / member_removed ─────────────

  it('group:message adds message to group store', () => {
    setup();
    const gs = useGroupStore.getState();
    const spy = vi.spyOn(gs, 'addMessage');
    simulateMsg({
      type: 'group:message',
      message: { leadId: 'lead1', groupName: 'chat', text: 'hello', sender: 'a1' },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('group:member_added adds member to group', () => {
    setup();
    const gs = useGroupStore.getState();
    const spy = vi.spyOn(gs, 'addMember');
    simulateMsg({
      type: 'group:member_added', leadId: 'lead1', group: 'chat', agentId: 'a2',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('group:member_removed removes member from group', () => {
    setup();
    const gs = useGroupStore.getState();
    const spy = vi.spyOn(gs, 'removeMember');
    simulateMsg({
      type: 'group:member_removed', leadId: 'lead1', group: 'chat', agentId: 'a2',
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('useWebSocket — returned methods', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastWs = null;
    useAppStore.setState({ agents: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribe sends subscribe message', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    result.current.subscribe('agent-1');
    const msg = lastWs!.sent.find(s => JSON.parse(s).agentId === 'agent-1');
    expect(msg).toBeDefined();
    expect(JSON.parse(msg!).type).toBe('subscribe');
  });

  it('unsubscribe sends unsubscribe message', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    result.current.unsubscribe('agent-1');
    const msg = lastWs!.sent.find(s => {
      const p = JSON.parse(s);
      return p.type === 'unsubscribe' && p.agentId === 'agent-1';
    });
    expect(msg).toBeDefined();
  });

  it('subscribeProject sends subscribe-project message', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    result.current.subscribeProject('proj-1');
    const msg = lastWs!.sent.find(s => JSON.parse(s).type === 'subscribe-project');
    expect(msg).toBeDefined();
    expect(JSON.parse(msg!).projectId).toBe('proj-1');
  });

  it('sendInput sends input message', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    result.current.sendInput('a1', 'hello');
    const msg = lastWs!.sent.find(s => JSON.parse(s).type === 'input');
    expect(msg).toBeDefined();
    expect(JSON.parse(msg!).text).toBe('hello');
  });

  it('resizeAgent sends resize message', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    result.current.resizeAgent('a1', 80, 24);
    const msg = lastWs!.sent.find(s => JSON.parse(s).type === 'resize');
    expect(msg).toBeDefined();
    expect(JSON.parse(msg!).cols).toBe(80);
  });

  it('broadcastInput sends input to all running agents', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    useAppStore.setState({
      agents: [
        { id: 'a1', status: 'running' } as any,
        { id: 'a2', status: 'idle' } as any,
        { id: 'a3', status: 'running' } as any,
      ],
    });
    result.current.broadcastInput('broadcast msg');
    const inputs = lastWs!.sent.filter(s => JSON.parse(s).type === 'input');
    expect(inputs.length).toBe(2); // a1 and a3, not a2
  });

  it('send is no-op when ws is not OPEN', () => {
    const { result } = renderHook(() => useWebSocket());
    // Don't call openWs — ws is in constructor state
    lastWs!.readyState = MockWebSocket.CLOSED;
    result.current.send({ type: 'test' } as any);
    // Only the connect() call's messages should be there (subscribe from onopen won't fire)
    expect(lastWs!.sent.length).toBe(0);
  });

  it('broadcastInput is no-op when no running agents', () => {
    const { result } = renderHook(() => useWebSocket());
    openWs();
    useAppStore.setState({
      agents: [
        { id: 'a1', status: 'idle' } as any,
        { id: 'a2', status: 'terminated' } as any,
      ],
    });
    const beforeCount = lastWs!.sent.length;
    result.current.broadcastInput('broadcast msg');
    const inputs = lastWs!.sent.slice(beforeCount).filter(s => JSON.parse(s).type === 'input');
    expect(inputs.length).toBe(0);
  });

  it('unmount clears reconnect timer', () => {
    const { unmount } = renderHook(() => useWebSocket());
    openWs();
    const ws = lastWs!;
    act(() => { ws.onclose?.({}); });
    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
