import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock logger ───────────────────────────────────────────────────
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock agentFiles ───────────────────────────────────────────────
vi.mock('../agents/agentFiles.js', () => ({
  agentFlagForRole: (roleId: string) => roleId,
}));

// ── Mock RoleFileWriter ──────────────────────────────────────────
vi.mock('../adapters/RoleFileWriter.js', () => ({
  createRoleFileWriter: vi.fn(() => ({
    writeRoleFiles: vi.fn().mockResolvedValue([]),
  })),
  listRoleFileWriterProviders: vi.fn(() => ['copilot']),
}));

// ── Mock AdapterFactory ───────────────────────────────────────
const mockStart = vi.fn();
const mockOn = vi.fn();
const mockTerminate = vi.fn().mockResolvedValue(undefined);
const mockCancel = vi.fn().mockResolvedValue(undefined);
const mockPrompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

const mockAdapter: Record<string, any> = {
  start: mockStart,
  on: mockOn,
  terminate: mockTerminate,
  cancel: mockCancel,
  prompt: mockPrompt,
  type: 'acp',
  isPrompting: false,
};

vi.mock('../adapters/AdapterFactory.js', () => ({
  createAdapterForProvider: vi.fn(() => ({
    adapter: mockAdapter,
    backend: 'acp',
    fallback: false,
  })),
  buildStartOptions: vi.fn((config: any, agentOpts: any) => ({
    options: {
      cliCommand: config.binaryOverride || config.cliCommand || 'copilot',
      cliArgs: config.cliArgs ?? [],
      cwd: agentOpts.cwd ?? process.cwd(),
      sessionId: agentOpts.sessionId,
      model: config.model,
    },
    modelResolution: undefined,
  })),
}));

// ── Mock requestContext (no-op) ───────────────────────────────────
vi.mock('../middleware/requestContext.js', () => ({
  runWithAgentContext: (_id: string, _role: string, _pid: string | undefined, fn: () => any) => fn(),
}));

import { startAcp } from '../agents/AgentAcpBridge.js';
import type { ServerConfig } from '../config.js';

// ── Helpers ───────────────────────────────────────────────────────

function createFakeAgent(overrides: Record<string, any> = {}) {
  const fake = {
    id: 'agent-resume-test',
    role: { id: 'developer', name: 'Developer', description: 'Dev', model: undefined, systemPrompt: 'You are a dev.' },
    autopilot: true,
    model: undefined,
    resumeSessionId: undefined,
    cwd: '/test/project',
    _phase: 'idle' as string,
    get phase() { return this._phase; },
    get status() {
      switch (this._phase) {
        case 'starting': return 'creating';
        case 'running': case 'thinking': case 'resuming': return 'running';
        case 'idle': return 'idle';
        case 'stopping': case 'stopped': return 'terminated';
        case 'error': return 'failed';
        default: return 'idle';
      }
    },
    transitionTo(phase: string) { this._phase = phase; },
    sessionId: undefined,
    exitError: undefined,
    get isResuming() { return this._phase === 'resuming'; },
    _setResuming() { this._phase = 'resuming'; },
    _finishResuming() { if (this._phase === 'resuming') this._phase = 'idle'; },
    _setAcpConnection: vi.fn(),
    _notifyExit: vi.fn(),
    _notifySessionReady: vi.fn(),
    _notifySessionResumeFailed: vi.fn(),
    _notifyModelFallback: vi.fn(),
    _notifyStatusChange: vi.fn(),
    _notifyData: vi.fn(),
    _notifyContent: vi.fn(),
    _notifyThinking: vi.fn(),
    _notifyToolCall: vi.fn(),
    _notifyPlan: vi.fn(),
    _notifyResponseStart: vi.fn(),
    _notifyUsage: vi.fn(),
    _notifyContextCompacted: vi.fn(),
    get _isTerminated() { return this._phase === 'stopped' || this._phase === 'error'; },
    _maxMessages: 500,
    _maxToolCalls: 200,
    messages: [] as string[],
    toolCalls: [] as any[],
    plan: [] as any[],
    inputTokens: 0,
    outputTokens: 0,
    hasRealUsageData: false,
    buildFullPrompt: vi.fn(() => 'prompt'),
    provider: undefined,
    projectId: undefined,
    ...overrides,
  } as any;
  return fake;
}

const fakeConfig: ServerConfig = {
  port: 3001,
  host: '127.0.0.1',
  cliCommand: 'copilot',
  cliArgs: [],
} as any;

// ── Tests ─────────────────────────────────────────────────────────

describe('_isResuming lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminate.mockResolvedValue(undefined);
  });

  describe('clearing on successful resume', () => {
    it('clears isResuming after successful resume (idle path)', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'sess-123',
        _phase: 'resuming',
      });
      mockStart.mockResolvedValue('sess-123');

      startAcp(agent, fakeConfig);

      await vi.waitFor(() => {
        expect(agent._notifySessionReady).toHaveBeenCalledWith('sess-123');
      });

      expect(agent.isResuming).toBe(false);
      expect(agent.status).toBe('idle');
    });

    it('clears isResuming after successful fresh start', async () => {
      const agent = createFakeAgent({
        _phase: 'idle',
      });
      agent.buildFullPrompt.mockReturnValue('Do the thing');
      mockStart.mockResolvedValue('new-sess');

      startAcp(agent, fakeConfig);

      await vi.waitFor(() => {
        expect(agent._notifySessionReady).toHaveBeenCalledWith('new-sess');
      });

      expect(agent.isResuming).toBe(false);
    });
  });

  describe('clearing on conn.start() failure', () => {
    it('clears isResuming when adapter start rejects', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'fail-sess',
        _phase: 'resuming',
      });
      mockStart.mockRejectedValue(new Error('Connection refused'));

      startAcp(agent, fakeConfig);

      await vi.waitFor(() => {
        expect(agent._notifyExit).toHaveBeenCalledWith(1);
      });

      expect(agent.isResuming).toBe(false);
      expect(agent.status).toBe('failed');
      expect(agent.exitError).toBe('Connection refused');
    });

    it('sets status to failed and notifies exit on start failure', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'crash-sess',
        _phase: 'resuming',
      });
      mockStart.mockRejectedValue(new Error('Process crashed'));

      startAcp(agent, fakeConfig);

      await vi.waitFor(() => {
        expect(agent._notifyExit).toHaveBeenCalledWith(1);
      });

      expect(agent.status).toBe('failed');
      expect(agent.isResuming).toBe(false);
    });
  });

  describe('event suppression while resuming', () => {
    it('suppresses text events while isResuming is true', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'sess-suppress',
        _phase: 'resuming',
      });

      // Capture the 'text' event handler
      const eventHandlers: Record<string, Function> = {};
      mockOn.mockImplementation((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      });

      // Don't resolve start yet — keep agent in resuming state
      let resolveStart!: (val: string) => void;
      mockStart.mockReturnValue(new Promise<string>((res) => { resolveStart = res; }));

      startAcp(agent, fakeConfig);

      // Fire text while still resuming
      eventHandlers['text']?.('should be suppressed');
      expect(agent._notifyData).not.toHaveBeenCalled();
      expect(agent.messages).toHaveLength(0);

      // Now resolve — agent should become idle and clear flag
      resolveStart('sess-suppress');

      await vi.waitFor(() => {
        expect(agent.isResuming).toBe(false);
      });
    });

    it('suppresses thinking events while isResuming is true', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'sess-think',
        _phase: 'resuming',
      });

      const eventHandlers: Record<string, Function> = {};
      mockOn.mockImplementation((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      });

      let resolveStart!: (val: string) => void;
      mockStart.mockReturnValue(new Promise<string>((res) => { resolveStart = res; }));

      startAcp(agent, fakeConfig);

      eventHandlers['thinking']?.('suppressed thought');
      expect(agent._notifyThinking).not.toHaveBeenCalled();

      resolveStart('sess-think');
      await vi.waitFor(() => { expect(agent.isResuming).toBe(false); });
    });

    it('suppresses content events while isResuming is true', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'sess-content',
        _phase: 'resuming',
      });

      const eventHandlers: Record<string, Function> = {};
      mockOn.mockImplementation((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      });

      let resolveStart!: (val: string) => void;
      mockStart.mockReturnValue(new Promise<string>((res) => { resolveStart = res; }));

      startAcp(agent, fakeConfig);

      eventHandlers['content']?.({ text: 'suppressed' });
      expect(agent._notifyContent).not.toHaveBeenCalled();

      resolveStart('sess-content');
      await vi.waitFor(() => { expect(agent.isResuming).toBe(false); });
    });

    it('suppresses tool_call events while isResuming is true', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'sess-tool',
        _phase: 'resuming',
      });

      const eventHandlers: Record<string, Function> = {};
      mockOn.mockImplementation((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      });

      let resolveStart!: (val: string) => void;
      mockStart.mockReturnValue(new Promise<string>((res) => { resolveStart = res; }));

      startAcp(agent, fakeConfig);

      eventHandlers['tool_call']?.({ toolCallId: 'tc-1', title: 'test' });
      expect(agent._notifyToolCall).not.toHaveBeenCalled();
      expect(agent.toolCalls).toHaveLength(0);

      resolveStart('sess-tool');
      await vi.waitFor(() => { expect(agent.isResuming).toBe(false); });
    });

    it('cancels in-flight prompting during resume', async () => {
      const agent = createFakeAgent({
        resumeSessionId: 'sess-prompt',
        _phase: 'resuming',
      });

      const eventHandlers: Record<string, Function> = {};
      mockOn.mockImplementation((event: string, handler: Function) => {
        eventHandlers[event] = handler;
      });

      let resolveStart!: (val: string) => void;
      mockStart.mockReturnValue(new Promise<string>((res) => { resolveStart = res; }));

      await startAcp(agent, fakeConfig);

      // Simulate provider firing 'prompting' during resume
      const statusCallsBefore = agent._notifyStatusChange.mock.calls.length;
      eventHandlers['prompting']?.(true);
      expect(mockAdapter.cancel).toHaveBeenCalled();
      // The prompting handler should NOT add another status change call
      expect(agent._notifyStatusChange.mock.calls.length).toBe(statusCallsBefore);

      resolveStart('sess-prompt');
      await vi.waitFor(() => { expect(agent.isResuming).toBe(false); });
    });
  });

  describe('encapsulation', () => {
    it('isResuming getter reflects private state', () => {
      const agent = createFakeAgent();
      expect(agent.isResuming).toBe(false);

      agent._setResuming();
      expect(agent.isResuming).toBe(true);

      agent._finishResuming();
      expect(agent.isResuming).toBe(false);
    });

    it('_finishResuming is idempotent', () => {
      const agent = createFakeAgent({ _phase: 'resuming' });
      expect(agent.isResuming).toBe(true);

      agent._finishResuming();
      expect(agent.isResuming).toBe(false);

      // Second clear should not throw
      agent._finishResuming();
      expect(agent.isResuming).toBe(false);
    });
  });
});

// ── Real Agent class tests ──────────────────────────────────────────
// These test the actual Agent class encapsulation, not the fake

import { Agent } from '../agents/Agent.js';

function makeRole() {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Develops things',
    systemPrompt: 'You are a dev.',
    color: '#000',
    icon: '💻',
    builtIn: true,
    model: 'test-model',
    receivesStatusUpdates: false,
  };
}

function makeConfig() {
  return {
    cliCommand: 'echo',
    cliArgs: [],
    port: 3000,
    maxConcurrent: 10,
  } as any;
}

describe('Agent isResuming encapsulation (real class)', () => {
  it('starts with isResuming = false', () => {
    const agent = new Agent(makeRole(), makeConfig(), 'task');
    expect(agent.isResuming).toBe(false);
  });

  it('_setResuming sets isResuming to true', () => {
    const agent = new Agent(makeRole(), makeConfig(), 'task');
    agent._setResuming();
    expect(agent.isResuming).toBe(true);
  });

  it('_finishResuming sets isResuming to false', () => {
    const agent = new Agent(makeRole(), makeConfig(), 'task');
    agent._setResuming();
    expect(agent.isResuming).toBe(true);
    agent._finishResuming();
    expect(agent.isResuming).toBe(false);
  });

  it('terminate() clears isResuming', async () => {
    const agent = new Agent(makeRole(), makeConfig(), 'task');
    agent._setResuming();
    expect(agent.isResuming).toBe(true);
    await agent.terminate();
    expect(agent.isResuming).toBe(false);
  });

  it('isResuming is not directly writable', () => {
    const agent = new Agent(makeRole(), makeConfig(), 'task');
    // TypeScript prevents this at compile time, but verify at runtime
    // that the getter can't be overwritten via assignment
    expect(() => {
      (agent as any).isResuming = true;
    }).toThrow();
  });

  it('_finishResuming is idempotent on real Agent', () => {
    const agent = new Agent(makeRole(), makeConfig(), 'task');
    agent._finishResuming();
    expect(agent.isResuming).toBe(false);
    agent._finishResuming();
    expect(agent.isResuming).toBe(false);
  });
});
