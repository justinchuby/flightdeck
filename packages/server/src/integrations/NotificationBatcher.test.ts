// packages/server/src/integrations/NotificationBatcher.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationBatcher } from './NotificationBatcher.js';
import type { NotificationEvent, MessagingAdapter, OutboundMessage } from './types.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockAdapter(): MessagingAdapter & { sentMessages: OutboundMessage[] } {
  const sentMessages: OutboundMessage[] = [];
  return {
    platform: 'telegram',
    sentMessages,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    sendMessage: vi.fn(async (msg: OutboundMessage) => { sentMessages.push(msg); }),
    onMessage: vi.fn(),
  };
}

function createMockAgentManager(): any {
  const handlers = new Map<string, ((...args: any[]) => void)[]>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const list = handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    getProjectIdForAgent: vi.fn().mockReturnValue('project-1'),
    emit(event: string, data: any) {
      for (const h of handlers.get(event) ?? []) {
        h(data);
      }
    },
    _handlers: handlers,
  };
}

function createEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    category: 'agent_spawned',
    projectId: 'project-1',
    title: 'Agent spawned: Developer',
    body: 'Developer (abc12345) joined the project.',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('NotificationBatcher', () => {
  let bridge: NotificationBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new NotificationBatcher();
  });

  afterEach(() => {
    bridge.stop();
    vi.useRealTimers();
  });

  // ── Subscriptions ─────────────────────────────────────────

  it('subscribes a chat to a project', () => {
    bridge.subscribe('chat-1', 'project-1');
    const subs = bridge.getSubscriptions('chat-1');
    expect(subs).toHaveLength(1);
    expect(subs[0].projectId).toBe('project-1');
    expect(subs[0].categories).toEqual([]);
  });

  it('updates subscription if same chat+project', () => {
    bridge.subscribe('chat-1', 'project-1', ['agent_spawned']);
    bridge.subscribe('chat-1', 'project-1', ['task_completed']);

    const subs = bridge.getSubscriptions('chat-1');
    expect(subs).toHaveLength(1);
    expect(subs[0].categories).toEqual(['task_completed']);
  });

  it('unsubscribes a chat from a project', () => {
    bridge.subscribe('chat-1', 'project-1');
    bridge.unsubscribe('chat-1', 'project-1');
    expect(bridge.getSubscriptions('chat-1')).toHaveLength(0);
  });

  it('lists all subscriptions', () => {
    bridge.subscribe('chat-1', 'project-1');
    bridge.subscribe('chat-2', 'project-2');
    expect(bridge.getAllSubscriptions()).toHaveLength(2);
  });

  // ── Event Batching ────────────────────────────────────────

  it('batches events within the 5s window', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1');

    bridge.queueEvent(createEvent({ title: 'Event 1' }));
    bridge.queueEvent(createEvent({ title: 'Event 2' }));

    expect(bridge.pendingCount()).toBe(2);

    // Before flush — no messages sent
    expect(adapter.sentMessages).toHaveLength(0);

    // Advance past batch window
    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('2 updates');
    expect(adapter.sentMessages[0].text).toContain('Event 1');
    expect(adapter.sentMessages[0].text).toContain('Event 2');
  });

  it('sends single events without batch header', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1');

    bridge.queueEvent(createEvent({ title: 'Solo Event', body: 'Details here' }));

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toBe('Solo Event\nDetails here');
  });

  it('batches per-project separately', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1');
    bridge.subscribe('chat-1', 'project-2');

    bridge.queueEvent(createEvent({ projectId: 'project-1', title: 'P1 Event' }));
    bridge.queueEvent(createEvent({ projectId: 'project-2', title: 'P2 Event' }));

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages[0].text).toContain('P1 Event');
    expect(adapter.sentMessages[1].text).toContain('P2 Event');
  });

  it('does not send to unsubscribed chats', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    // No subscriptions

    bridge.queueEvent(createEvent());
    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(0);
  });

  // ── Category Filtering ────────────────────────────────────

  it('filters events by category when subscription specifies categories', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1', ['task_completed']);

    bridge.queueEvent(createEvent({ category: 'agent_spawned', title: 'Should be filtered' }));
    bridge.queueEvent(createEvent({ category: 'task_completed', title: 'Should be sent' }));

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('Should be sent');
  });

  it('sends all categories when subscription has empty categories', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1', []);

    bridge.queueEvent(createEvent({ category: 'agent_spawned' }));
    bridge.queueEvent(createEvent({ category: 'task_completed' }));

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('2 updates');
  });

  // ── Wire to AgentManager ──────────────────────────────────

  it('wires to AgentManager events', () => {
    const manager = createMockAgentManager();
    bridge.wire(manager);

    expect(manager.on).toHaveBeenCalledWith('agent:spawned', expect.any(Function));
    expect(manager.on).toHaveBeenCalledWith('agent:exit', expect.any(Function));
    expect(manager.on).toHaveBeenCalledWith('agent:crashed', expect.any(Function));
    expect(manager.on).toHaveBeenCalledWith('lead:decision', expect.any(Function));
    expect(manager.on).toHaveBeenCalledWith('agent:completion_reported', expect.any(Function));
  });

  it('generates notification from agent:spawned event', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1');

    const manager = createMockAgentManager();
    bridge.wire(manager);

    manager.emit('agent:spawned', {
      id: 'abc12345def',
      role: { id: 'developer', name: 'Developer' },
      projectId: 'project-1',
    });

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('Agent spawned: developer');
  });

  it('generates notification from lead:decision event', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    // Subscribe to the real project ID — NOT the lead agent ID
    bridge.subscribe('chat-1', 'decision-project-42');

    const manager = createMockAgentManager();
    // Mock resolves lead agent → real project ID
    manager.getProjectIdForAgent.mockReturnValue('decision-project-42');
    bridge.wire(manager);

    manager.emit('lead:decision', {
      id: 1,
      agentId: 'agent-1',
      agentRole: 'developer',
      leadId: 'lead-agent-007', // Deliberately different from projectId
      title: 'Use React',
      rationale: 'Better ecosystem',
      needsConfirmation: true,
      status: 'pending',
    });

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(manager.getProjectIdForAgent).toHaveBeenCalledWith('lead-agent-007');
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('Decision needs approval');
    expect(adapter.sentMessages[0].text).toContain('Better ecosystem');
  });

  // ── Force Flush ───────────────────────────────────────────

  it('flushAll sends all pending events immediately', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1');

    bridge.queueEvent(createEvent({ title: 'Urgent Event' }));
    expect(adapter.sentMessages).toHaveLength(0);

    bridge.flushAll();

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('Urgent Event');
  });

  // ── Pending Count ─────────────────────────────────────────

  it('tracks pending event count', () => {
    expect(bridge.pendingCount()).toBe(0);

    bridge.queueEvent(createEvent({ projectId: 'p1' }));
    bridge.queueEvent(createEvent({ projectId: 'p1' }));
    bridge.queueEvent(createEvent({ projectId: 'p2' }));

    expect(bridge.pendingCount()).toBe(3);

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(bridge.pendingCount()).toBe(0);
  });

  // ── Events ────────────────────────────────────────────────

  it('emits notification:batched event', () => {
    const handler = vi.fn();
    bridge.on('notification:batched', handler);
    bridge.subscribe('chat-1', 'project-1');

    bridge.queueEvent(createEvent());
    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toHaveLength(1);
  });

  it('emits notification:sent event', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'project-1');

    const handler = vi.fn();
    bridge.on('notification:sent', handler);

    bridge.queueEvent(createEvent());
    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual({ chatId: 'chat-1', count: 1 });
  });

  // ── Stop ──────────────────────────────────────────────────

  it('stop clears all state', () => {
    bridge.subscribe('chat-1', 'project-1');
    bridge.queueEvent(createEvent());

    bridge.stop();

    expect(bridge.pendingCount()).toBe(0);
    expect(bridge.getAllSubscriptions()).toHaveLength(0);
  });

  // ── Regression: C2 — lead:decision used leadId as projectId ──

  it('resolves projectId from agentManager for lead:decision events', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    // Subscribe to the REAL project ID, not the agent ID
    bridge.subscribe('chat-1', 'real-project-id');

    const manager = createMockAgentManager();
    // Simulate: leadId is an agent ID, getProjectIdForAgent resolves to real project
    manager.getProjectIdForAgent.mockReturnValue('real-project-id');
    bridge.wire(manager);

    // Emit lead:decision with leadId = agent ID (NOT project ID)
    manager.emit('lead:decision', {
      id: 1,
      agentId: 'agent-1',
      agentRole: 'developer',
      leadId: 'lead-agent-abc123', // This is an agent ID, not a project ID
      title: 'Use React',
      rationale: 'Better ecosystem',
      needsConfirmation: false,
      status: 'approved',
    });

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    // Should have resolved to 'real-project-id' and delivered to subscriber
    expect(manager.getProjectIdForAgent).toHaveBeenCalledWith('lead-agent-abc123');
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0].text).toContain('Decision recorded');
  });

  it('falls back to leadId when getProjectIdForAgent returns undefined', () => {
    const adapter = createMockAdapter();
    bridge.addAdapter(adapter);
    bridge.subscribe('chat-1', 'lead-agent-id');

    const manager = createMockAgentManager();
    manager.getProjectIdForAgent.mockReturnValue(undefined);
    bridge.wire(manager);

    manager.emit('lead:decision', {
      id: 2,
      agentId: 'agent-2',
      agentRole: 'developer',
      leadId: 'lead-agent-id',
      title: 'Fallback test',
      rationale: 'Testing fallback',
      needsConfirmation: true,
      status: 'pending',
    });

    vi.advanceTimersByTime(NotificationBatcher.BATCH_WINDOW_MS + 100);

    // Falls back to leadId since getProjectIdForAgent returned undefined
    expect(adapter.sentMessages).toHaveLength(1);
  });

  // ── H-3: Event listener leak prevention ────────────────────

  it('removes AgentManager listeners on stop()', () => {
    const manager = createMockAgentManager();
    bridge.wire(manager);

    // 5 events should be wired
    expect(manager.on).toHaveBeenCalledTimes(5);
    const totalBefore = (Array.from(manager._handlers.values()) as any[][]).reduce((sum, h) => sum + h.length, 0);
    expect(totalBefore).toBe(5);

    bridge.stop();

    // All listeners should be removed
    expect(manager.off).toHaveBeenCalledTimes(5);
    const totalAfter = (Array.from(manager._handlers.values()) as any[][]).reduce((sum, h) => sum + h.length, 0);
    expect(totalAfter).toBe(0);
  });

  it('does not leak listeners after stop + re-wire', () => {
    const manager = createMockAgentManager();
    bridge.wire(manager);
    bridge.stop();
    bridge.wire(manager);

    // Should have exactly 5 listeners (not 10)
    const total = (Array.from(manager._handlers.values()) as any[][]).reduce((sum, h) => sum + h.length, 0);
    expect(total).toBe(5);
  });
});
