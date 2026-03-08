// packages/server/src/integrations/IntegrationAgent.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntegrationAgent } from './IntegrationAgent.js';
import { NotificationBridge } from './NotificationBridge.js';
import type { InboundMessage } from './types.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock TelegramAdapter — prevent actual bot creation
vi.mock('./TelegramAdapter.js', () => {
  class MockTelegramAdapter {
    platform = 'telegram';
    _messageHandlers: Array<(msg: InboundMessage) => void> = [];
    _commandHandlers = new Map<string, (chatId: string, args: string) => Promise<string>>();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    sendMessage = vi.fn().mockResolvedValue(undefined);
    onMessage = vi.fn((handler: (msg: InboundMessage) => void) => {
      this._messageHandlers.push(handler);
    });
    registerCommand = vi.fn((cmd: string, handler: (chatId: string, args: string) => Promise<string>) => {
      this._commandHandlers.set(cmd, handler);
    });
    isRunning = vi.fn().mockReturnValue(true);
    isChatAllowed = vi.fn().mockReturnValue(true);
  }
  return { TelegramAdapter: MockTelegramAdapter };
});

function createMockAgentManager(): any {
  const agents: any[] = [];
  return {
    on: vi.fn(),
    getAll: vi.fn(() => agents),
    getByProject: vi.fn((projectId: string) => agents.filter(a => a.projectId === projectId)),
    getProjectIdForAgent: vi.fn().mockReturnValue('project-1'),
    _addAgent(agent: any) { agents.push(agent); },
  };
}

function createMockProjectRegistry(): any {
  return {
    list: vi.fn().mockReturnValue([
      { id: 'project-1', name: 'My Project', status: 'active' },
      { id: 'project-2', name: 'Other Project', status: 'completed' },
    ]),
  };
}

function createMockConfigStore(telegramEnabled = false): any {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    current: {
      telegram: {
        enabled: telegramEnabled,
        botToken: telegramEnabled ? 'test-token-123' : '',
        allowedChatIds: [],
        rateLimitPerMinute: 20,
      },
    },
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    emit(event: string, ...args: any[]) {
      for (const h of listeners.get(event) ?? []) {
        h(...args);
      }
    },
    _listeners: listeners,
  };
}

describe('IntegrationAgent', () => {
  let agent: IntegrationAgent;
  let agentManager: ReturnType<typeof createMockAgentManager>;
  let projectRegistry: ReturnType<typeof createMockProjectRegistry>;
  let configStore: ReturnType<typeof createMockConfigStore>;
  let bridge: NotificationBridge;

  beforeEach(() => {
    agentManager = createMockAgentManager();
    projectRegistry = createMockProjectRegistry();
    configStore = createMockConfigStore(false);
    bridge = new NotificationBridge();
  });

  afterEach(async () => {
    if (agent) {
      await agent.stop();
    }
  });

  // ── Construction ──────────────────────────────────────────

  it('constructs without starting adapters', () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    expect(agent.getAdapter('telegram')).toBeUndefined();
  });

  // ── Start / Stop ──────────────────────────────────────────

  it('starts without Telegram when not enabled', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();
    expect(agent.getAdapter('telegram')).toBeUndefined();
  });

  it('starts Telegram adapter when enabled', async () => {
    configStore = createMockConfigStore(true);
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();
    expect(agent.getAdapter('telegram')).toBeDefined();
  });

  it('stops cleanly', async () => {
    configStore = createMockConfigStore(true);
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    await agent.stop();
    expect(agent.getAdapter('telegram')).toBeUndefined();
  });

  // ── Session Binding ───────────────────────────────────────

  it('binds a chat session to a project', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const session = agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');
    expect(session.chatId).toBe('chat-1');
    expect(session.platform).toBe('telegram');
    expect(session.projectId).toBe('project-1');
    expect(session.boundBy).toBe('user-1');
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it('retrieves session and refreshes TTL', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');
    const session = agent.getSession('chat-1');
    expect(session).toBeDefined();
    expect(session!.projectId).toBe('project-1');
  });

  it('returns undefined for expired sessions', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const session = agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');
    // Force expiry
    session.expiresAt = Date.now() - 1000;

    expect(agent.getSession('chat-1')).toBeUndefined();
  });

  it('lists all active sessions', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');
    agent.bindSession('chat-2', 'telegram', 'project-2', 'user-2');

    expect(agent.getAllSessions()).toHaveLength(2);
  });

  it('subscribes chat to notifications when binding session', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');

    const subs = bridge.getSubscriptions('chat-1');
    expect(subs).toHaveLength(1);
    expect(subs[0].projectId).toBe('project-1');
  });

  // ── Command Handlers ──────────────────────────────────────

  it('registers /status, /projects, /agents commands', async () => {
    configStore = createMockConfigStore(true);
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    expect(adapter.registerCommand).toHaveBeenCalledWith('status', expect.any(Function));
    expect(adapter.registerCommand).toHaveBeenCalledWith('projects', expect.any(Function));
    expect(adapter.registerCommand).toHaveBeenCalledWith('agents', expect.any(Function));
  });

  it('/status returns formatted status', async () => {
    configStore = createMockConfigStore(true);
    agentManager._addAgent({
      id: 'agent-1',
      role: { id: 'developer' },
      status: 'running',
      projectId: 'project-1',
    });

    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    const statusHandler = adapter._commandHandlers.get('status');
    expect(statusHandler).toBeDefined();

    const result = await statusHandler!('chat-1', '');
    expect(result).toContain('Flightdeck Status');
    expect(result).toContain('1 running / 1 total');
  });

  it('/projects returns project list', async () => {
    configStore = createMockConfigStore(true);
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    const projectsHandler = adapter._commandHandlers.get('projects');
    const result = await projectsHandler!('chat-1', '');
    expect(result).toContain('Projects');
    expect(result).toContain('project-1');
    expect(result).toContain('My Project');
  });

  it('/agents returns agent list', async () => {
    configStore = createMockConfigStore(true);
    agentManager._addAgent({
      id: 'abc12345',
      role: 'developer',
      status: 'running',
      projectId: 'project-1',
    });

    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    const agentsHandler = adapter._commandHandlers.get('agents');
    const result = await agentsHandler!('chat-1', '');
    expect(result).toContain('Active Agents');
    expect(result).toContain('abc12345');
  });

  it('/projects handles missing registry gracefully', async () => {
    configStore = createMockConfigStore(true);
    agent = new IntegrationAgent(agentManager, undefined, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    const projectsHandler = adapter._commandHandlers.get('projects');
    const result = await projectsHandler!('chat-1', '');
    expect(result).toContain('not available');
  });

  // ── NotificationBridge Integration ────────────────────────

  it('wires NotificationBridge to AgentManager on start', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    // Bridge should have subscribed to AgentManager events
    expect(agentManager.on).toHaveBeenCalled();
  });

  it('getBridge returns the bridge instance', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    expect(agent.getBridge()).toBe(bridge);
  });

  // ── Dynamic Config Changes ────────────────────────────────

  it('starts Telegram adapter on config change', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();
    expect(agent.getAdapter('telegram')).toBeUndefined();

    // Simulate config change enabling Telegram
    configStore.current.telegram.enabled = true;
    configStore.current.telegram.botToken = 'new-token';
    configStore.emit('config:reloaded');

    // Wait for async startTelegram to complete
    await new Promise(r => setTimeout(r, 50));

    expect(agent.getAdapter('telegram')).toBeDefined();
  });

  // ── Session Cleanup ───────────────────────────────────────

  it('cleans expired sessions on getAllSessions', async () => {
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const session = agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');
    session.expiresAt = Date.now() - 1000;

    const active = agent.getAllSessions();
    expect(active).toHaveLength(0);
  });

  // ── Regression: C1 — bind command was unreachable ─────

  it('processes bind command even without an active session', async () => {
    configStore = createMockConfigStore(true);
    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    expect(adapter.onMessage).toHaveBeenCalled();

    // Get the message handler
    const msgHandler = adapter._messageHandlers[0];
    expect(msgHandler).toBeDefined();

    // Send bind command without any existing session
    msgHandler({
      platform: 'telegram',
      chatId: 'new-chat',
      userId: 'user-1',
      displayName: 'Alice',
      text: 'bind project-1',
      receivedAt: Date.now(),
    });

    // Session should have been created
    const session = agent.getSession('new-chat');
    expect(session).toBeDefined();
    expect(session!.projectId).toBe('project-1');
  });

  // ── Regression: M6 — role renders as [object Object] ──

  it('/agents renders role.id not [object Object]', async () => {
    configStore = createMockConfigStore(true);
    agentManager._addAgent({
      id: 'abc12345',
      role: { id: 'developer', name: 'Developer' }, // Role object, not string
      status: 'running',
      projectId: 'project-1',
    });

    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    const adapter = agent.getAdapter('telegram') as any;
    const agentsHandler = adapter._commandHandlers.get('agents');
    const result = await agentsHandler!('chat-1', '');
    expect(result).toContain('developer');
    expect(result).not.toContain('[object Object]');
  });

  // ── Regression: M3 — input sanitization ───────────────

  it('sanitizes control characters in inbound messages', async () => {
    configStore = createMockConfigStore(true);
    agentManager._addAgent({
      id: 'lead-1',
      role: { id: 'lead' },
      status: 'running',
      projectId: 'project-1',
      sendMessage: vi.fn(),
    });

    agent = new IntegrationAgent(agentManager, projectRegistry, configStore, bridge);
    await agent.start();

    // Bind a session first
    agent.bindSession('chat-1', 'telegram', 'project-1', 'user-1');

    const adapter = agent.getAdapter('telegram') as any;
    const msgHandler = adapter._messageHandlers[0];

    // Send message with control characters
    msgHandler({
      platform: 'telegram',
      chatId: 'chat-1',
      userId: 'user-1',
      displayName: 'Alice',
      text: 'Hello\x00\x01\x02World\u200B',
      receivedAt: Date.now(),
    });

    // The lead agent should receive sanitized text
    const leadAgent = agentManager.getByProject('project-1')
      .find((a: any) => a.role.id === 'lead');
    expect(leadAgent?.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('HelloWorld'),
    );
    expect(leadAgent?.sendMessage).toHaveBeenCalledWith(
      expect.not.stringContaining('\x00'),
    );
  });
});
