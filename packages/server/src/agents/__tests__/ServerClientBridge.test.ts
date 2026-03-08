import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { ServerClientAdapter, startRemoteBridge } from '../ServerClientBridge.js';
import { AgentServerClient } from '../AgentServerClient.js';
import type { AgentServerClientOptions } from '../AgentServerClient.js';
import type {
  AgentServerTransport,
  TransportState,
  AgentServerMessage,
  OrchestratorMessage,
  MessageScope,
  AgentEventMessage,
  AgentExitedMessage,
} from '../../transport/types.js';

// ── Mock Transport ──────────────────────────────────────────────────

class MockTransport implements AgentServerTransport {
  state: TransportState = 'disconnected';
  supportsReconnect = true;

  private messageHandlers: Array<(msg: AgentServerMessage) => void> = [];
  private stateHandlers: Array<(state: TransportState) => void> = [];

  sent: OrchestratorMessage[] = [];

  connect = vi.fn(async () => { this.setState('connected'); });
  disconnect = vi.fn(async () => { this.setState('disconnected'); });
  send = vi.fn((msg: OrchestratorMessage) => { this.sent.push(msg); });

  onMessage(handler: (msg: AgentServerMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => { this.messageHandlers = this.messageHandlers.filter(h => h !== handler); };
  }

  onStateChange(handler: (state: TransportState) => void): () => void {
    this.stateHandlers.push(handler);
    return () => { this.stateHandlers = this.stateHandlers.filter(h => h !== handler); };
  }

  receiveMessage(msg: AgentServerMessage): void {
    for (const handler of this.messageHandlers) handler(msg);
  }

  setState(state: TransportState): void {
    this.state = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  lastRequestId(): string {
    return (this.sent[this.sent.length - 1] as any).requestId;
  }
}

// ── Mock Agent ──────────────────────────────────────────────────────

function createMockAgent(overrides: Partial<{
  id: string;
  role: { id: string; name: string; model: string; systemPrompt: string };
  model: string;
  task: string;
  parentId: string;
  dagTaskId: string;
  projectId: string;
  projectName: string;
  cwd: string;
  autopilot: boolean;
  resumeSessionId: string;
  status: string;
  sessionId: string | null;
  exitError: string;
}> = {}) {
  return {
    id: overrides.id ?? 'agent-001',
    role: overrides.role ?? { id: 'developer', name: 'Developer', model: 'fast', systemPrompt: 'You are a dev.' },
    model: overrides.model ?? 'fast',
    task: overrides.task ?? 'implement feature',
    parentId: overrides.parentId,
    dagTaskId: overrides.dagTaskId,
    projectId: overrides.projectId ?? 'proj-1',
    projectName: overrides.projectName ?? 'test-project',
    cwd: overrides.cwd ?? '/test',
    autopilot: overrides.autopilot ?? true,
    resumeSessionId: overrides.resumeSessionId,
    status: overrides.status ?? 'creating',
    sessionId: overrides.sessionId ?? null,
    exitError: overrides.exitError,
    budget: undefined as { maxConcurrent: number; runningCount: number } | undefined,
    _setAcpConnection: vi.fn(),
    _notifySessionReady: vi.fn(),
    _notifyExit: vi.fn(),
    _notifyData: vi.fn(),
    _notifyContent: vi.fn(),
    _notifyThinking: vi.fn(),
    _notifyToolCall: vi.fn(),
    _notifyPlan: vi.fn(),
    _notifyPermissionRequest: vi.fn(),
    _notifyUsage: vi.fn(),
    _notifyContextCompacted: vi.fn(),
    _notifyResponseStart: vi.fn(),
    _notifyStatusChange: vi.fn(),
    _notifyHung: vi.fn(),
    _isTerminated: false,
    _maxMessages: 500,
    _maxToolCalls: 200,
    messages: [] as string[],
    toolCalls: [] as any[],
    plan: [] as any[],
    inputTokens: 0,
    outputTokens: 0,
    hasRealUsageData: false,
    contextWindowSize: 0,
    contextWindowUsed: 0,
    estimateTokensFromContent: vi.fn(),
    recordTokenSample: vi.fn(),
    buildContextManifest: vi.fn(() => '== CONTEXT =='),
    events: { notifyData: vi.fn(), notifyStatus: vi.fn() },
    systemPaused: false,
    pendingMessageCount: 0,
    _drainOneMessage: vi.fn(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

const scope: MessageScope = { projectId: 'test-proj', teamId: 'team-1' };

function createClientAndTransport() {
  const transport = new MockTransport();
  const client = new AgentServerClient(transport, scope);
  return { client, transport };
}

async function createConnectedClient() {
  const { client, transport } = createClientAndTransport();
  await client.connect();
  return { client, transport };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ServerClientAdapter', () => {
  let client: AgentServerClient;
  let transport: MockTransport;

  beforeEach(async () => {
    ({ client, transport } = await createConnectedClient());
  });

  afterEach(async () => {
    await client.dispose().catch(() => {});
  });

  describe('construction', () => {
    it('has type "server-client"', () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      expect(adapter.type).toBe('server-client');
    });

    it('starts as not connected', () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);
      expect(adapter.currentSessionId).toBeNull();
    });

    it('does not support images', () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      expect(adapter.supportsImages).toBe(false);
    });
  });

  describe('start', () => {
    it('subscribes to events and becomes connected', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      const sessionId = await adapter.start({ cliCommand: '' });

      expect(adapter.isConnected).toBe(true);
      expect(sessionId).toBe('agent-001');
      expect(adapter.currentSessionId).toBe('agent-001');

      // Should have sent a subscribe message
      const subscribes = transport.sent.filter(m => m.type === 'subscribe');
      expect(subscribes.length).toBe(1);
      expect((subscribes[0] as any).agentId).toBe('agent-001');
    });

    it('throws if adapter is disposed', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      adapter.terminate();
      await expect(adapter.start({ cliCommand: '' })).rejects.toThrow('disposed');
    });
  });

  describe('prompt', () => {
    it('sends a prompt via client', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const result = await adapter.prompt('Hello world');
      expect(result.stopReason).toBe('end_turn');

      const sends = transport.sent.filter(m => m.type === 'send_message');
      expect(sends.length).toBe(1);
      expect((sends[0] as any).agentId).toBe('agent-001');
      expect((sends[0] as any).content).toBe('Hello world');
    });

    it('sets isPrompting to true', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      await adapter.prompt('test');
      expect(adapter.isPrompting).toBe(true);
      expect(adapter.promptingStartedAt).not.toBeNull();
    });

    it('serializes content blocks to JSON', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const blocks = [{ type: 'text' as const, text: 'hello' }];
      await adapter.prompt(blocks);

      const sends = transport.sent.filter(m => m.type === 'send_message');
      expect((sends[0] as any).content).toBe(JSON.stringify(blocks));
    });

    it('throws if adapter is disposed', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });
      adapter.terminate();
      await expect(adapter.prompt('test')).rejects.toThrow('disposed');
    });
  });

  describe('cancel', () => {
    it('sends a cancel message', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      await adapter.cancel();
      const cancels = transport.sent.filter(m => m.type === 'cancel_agent');
      expect(cancels.length).toBe(1);
      expect((cancels[0] as any).agentId).toBe('agent-001');
    });
  });

  describe('terminate', () => {
    it('sends terminate and disconnects', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      adapter.terminate();
      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);

      const terminates = transport.sent.filter(m => m.type === 'terminate_agent');
      expect(terminates.length).toBe(1);
    });

    it('is idempotent', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      adapter.terminate();
      adapter.terminate(); // should not throw

      const terminates = transport.sent.filter(m => m.type === 'terminate_agent');
      expect(terminates.length).toBe(1);
    });

    it('clears event tracking on client', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      // Simulate an event to create tracking
      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-1',
        eventType: 'text',
        data: { text: 'hello' },
      });

      expect(client.trackedAgentCount).toBe(1);

      adapter.terminate();
      expect(client.trackedAgentCount).toBe(0);
    });
  });

  describe('event translation', () => {
    it('translates text events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const textHandler = vi.fn();
      adapter.on('text', textHandler);

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-1',
        eventType: 'text',
        data: { text: 'Hello from remote' },
      });

      expect(textHandler).toHaveBeenCalledWith('Hello from remote');
    });

    it('translates thinking events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('thinking', handler);

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-2',
        eventType: 'thinking',
        data: { text: 'Thinking...' },
      });

      expect(handler).toHaveBeenCalledWith('Thinking...');
    });

    it('translates tool_call events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('tool_call', handler);

      const toolData = { toolCallId: 'tc-1', title: 'read_file', kind: 'file', status: 'running' };
      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-3',
        eventType: 'tool_call',
        data: toolData,
      });

      expect(handler).toHaveBeenCalledWith(toolData);
    });

    it('translates prompt_complete events and resets prompting state', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      await adapter.prompt('test');
      expect(adapter.isPrompting).toBe(true);

      const handler = vi.fn();
      adapter.on('prompt_complete', handler);

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-4',
        eventType: 'prompt_complete',
        data: { stopReason: 'end_turn' },
      });

      expect(handler).toHaveBeenCalledWith('end_turn');
      expect(adapter.isPrompting).toBe(false);
      expect(adapter.promptingStartedAt).toBeNull();
    });

    it('translates prompting events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('prompting', handler);

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-5',
        eventType: 'prompting',
        data: { active: true },
      });

      expect(handler).toHaveBeenCalledWith(true);
      expect(adapter.isPrompting).toBe(true);
      expect(adapter.promptingStartedAt).not.toBeNull();

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-6',
        eventType: 'prompting',
        data: { active: false },
      });

      expect(handler).toHaveBeenCalledWith(false);
      expect(adapter.isPrompting).toBe(false);
    });

    it('translates response_start events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('response_start', handler);

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-7',
        eventType: 'response_start',
        data: {},
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('translates usage events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('usage', handler);

      const usageData = { inputTokens: 100, outputTokens: 50 };
      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-8',
        eventType: 'usage',
        data: usageData,
      });

      expect(handler).toHaveBeenCalledWith(usageData);
    });

    it('translates plan events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('plan', handler);

      const entries = [{ content: 'step 1', priority: 'high', status: 'pending' }];
      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-9',
        eventType: 'plan',
        data: { entries },
      });

      expect(handler).toHaveBeenCalledWith(entries);
    });

    it('translates permission_request events', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('permission_request', handler);

      const reqData = { id: 'perm-1', toolName: 'write_file', arguments: {} };
      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-10',
        eventType: 'permission_request',
        data: reqData,
      });

      expect(handler).toHaveBeenCalledWith(reqData);
    });

    it('ignores events for other agents', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('text', handler);

      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-OTHER',
        eventId: 'ev-x',
        eventType: 'text',
        data: { text: 'wrong agent' },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('exit handling', () => {
    it('emits exit event when agent exits', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('exit', handler);

      transport.receiveMessage({
        type: 'agent_exited',
        agentId: 'agent-001',
        exitCode: 0,
      });

      expect(handler).toHaveBeenCalledWith(0);
      expect(adapter.isConnected).toBe(false);
    });

    it('clears tracking on exit', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      // Create tracking via an event
      transport.receiveMessage({
        type: 'agent_event',
        agentId: 'agent-001',
        eventId: 'ev-1',
        eventType: 'text',
        data: { text: 'hi' },
      });
      expect(client.trackedAgentCount).toBe(1);

      transport.receiveMessage({
        type: 'agent_exited',
        agentId: 'agent-001',
        exitCode: 0,
      });

      expect(client.trackedAgentCount).toBe(0);
    });

    it('ignores exit events for other agents', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('exit', handler);

      transport.receiveMessage({
        type: 'agent_exited',
        agentId: 'agent-OTHER',
        exitCode: 1,
      });

      expect(handler).not.toHaveBeenCalled();
      expect(adapter.isConnected).toBe(true);
    });

    it('handles non-zero exit code', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      const handler = vi.fn();
      adapter.on('exit', handler);

      transport.receiveMessage({
        type: 'agent_exited',
        agentId: 'agent-001',
        exitCode: 1,
        reason: 'crash',
      });

      expect(handler).toHaveBeenCalledWith(1);
    });
  });

  describe('resolvePermission', () => {
    it('sends permission response as a message', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      adapter.resolvePermission(true);

      // Wait for async send
      await new Promise(r => setTimeout(r, 10));

      const sends = transport.sent.filter(m => m.type === 'send_message');
      expect(sends.length).toBe(1);
      expect((sends[0] as any).content).toContain('Permission approved');
    });

    it('sends denial message', async () => {
      const adapter = new ServerClientAdapter(client, 'agent-001');
      await adapter.start({ cliCommand: '' });

      adapter.resolvePermission(false);
      await new Promise(r => setTimeout(r, 10));

      const sends = transport.sent.filter(m => m.type === 'send_message');
      expect((sends[0] as any).content).toContain('Permission denied');
    });
  });
});

describe('startRemoteBridge', () => {
  let client: AgentServerClient;
  let transport: MockTransport;

  beforeEach(async () => {
    ({ client, transport } = await createConnectedClient());
  });

  afterEach(async () => {
    await client.dispose().catch(() => {});
  });

  it('spawns agent on remote server and wires adapter', async () => {
    const agent = createMockAgent();

    // Start the bridge — spawn() is called which sends a spawn_agent message
    const bridgePromise = startRemoteBridge(agent as any, client, 'Initial system prompt');

    // Respond to spawn request
    const spawnMsg = transport.sent.find(m => m.type === 'spawn_agent')!;
    transport.receiveMessage({
      type: 'agent_spawned',
      requestId: (spawnMsg as any).requestId,
      agentId: 'agent-001',
      role: 'developer',
      model: 'fast',
      pid: 1234,
    });

    await bridgePromise;

    // Agent should have had its connection set
    expect(agent._setAcpConnection).toHaveBeenCalledOnce();
    expect(agent.status).toBe('running');
    expect(agent._notifySessionReady).toHaveBeenCalledOnce();

    // Initial prompt should have been sent
    const sends = transport.sent.filter(m => m.type === 'send_message');
    expect(sends.length).toBe(1);
    expect((sends[0] as any).content).toBe('Initial system prompt');
  });

  it('includes context data in spawn request', async () => {
    const agent = createMockAgent({
      dagTaskId: 'task-123',
      parentId: 'parent-001',
    });

    const bridgePromise = startRemoteBridge(agent as any, client);

    const spawnMsg = transport.sent.find(m => m.type === 'spawn_agent')!;
    expect((spawnMsg as any).context).toMatchObject({
      agentId: 'agent-001',
      parentId: 'parent-001',
      dagTaskId: 'task-123',
      projectId: 'proj-1',
    });

    // Complete the spawn
    transport.receiveMessage({
      type: 'agent_spawned',
      requestId: (spawnMsg as any).requestId,
      agentId: 'agent-001',
      role: 'developer',
      model: 'fast',
      pid: 1234,
    });

    await bridgePromise;
  });

  it('skips initial prompt on resume', async () => {
    const agent = createMockAgent({ resumeSessionId: 'sess-old' });

    const bridgePromise = startRemoteBridge(agent as any, client);

    const spawnMsg = transport.sent.find(m => m.type === 'spawn_agent')!;
    transport.receiveMessage({
      type: 'agent_spawned',
      requestId: (spawnMsg as any).requestId,
      agentId: 'agent-001',
      role: 'developer',
      model: 'fast',
      pid: 1234,
    });

    await bridgePromise;

    // No initial prompt sent (undefined passed)
    const sends = transport.sent.filter(m => m.type === 'send_message');
    expect(sends.length).toBe(0);
  });

  it('handles spawn failure gracefully', async () => {
    const agent = createMockAgent();

    const bridgePromise = startRemoteBridge(agent as any, client);

    // Respond with error
    const spawnMsg = transport.sent.find(m => m.type === 'spawn_agent')!;
    transport.receiveMessage({
      type: 'error',
      requestId: (spawnMsg as any).requestId,
      code: 'SPAWN_FAILED',
      message: 'No available slots',
    });

    await bridgePromise;

    expect(agent.status).toBe('failed');
    expect(agent.exitError).toBe('No available slots');
    expect(agent._notifyExit).toHaveBeenCalledWith(1);
  });

  it('routes events through adapter to agent', async () => {
    const agent = createMockAgent();

    const bridgePromise = startRemoteBridge(agent as any, client, 'prompt');

    const spawnMsg = transport.sent.find(m => m.type === 'spawn_agent')!;
    transport.receiveMessage({
      type: 'agent_spawned',
      requestId: (spawnMsg as any).requestId,
      agentId: 'agent-001',
      role: 'developer',
      model: 'fast',
      pid: 1234,
    });

    await bridgePromise;

    // Get the adapter that was passed to _setAcpConnection
    const adapter = agent._setAcpConnection.mock.calls[0][0] as ServerClientAdapter;

    // Verify it's a ServerClientAdapter
    expect(adapter.type).toBe('server-client');
    expect(adapter.isConnected).toBe(true);
  });

  it('uses agent role.model when model is not overridden', async () => {
    const agent = createMockAgent();
    agent.model = undefined as any;
    agent.role.model = 'default-model';

    const bridgePromise = startRemoteBridge(agent as any, client);

    const spawnMsg = transport.sent.find(m => m.type === 'spawn_agent')!;
    expect((spawnMsg as any).model).toBe('default-model');

    transport.receiveMessage({
      type: 'agent_spawned',
      requestId: (spawnMsg as any).requestId,
      agentId: 'agent-001',
      role: 'developer',
      model: 'default-model',
      pid: null,
    });

    await bridgePromise;
  });
});
