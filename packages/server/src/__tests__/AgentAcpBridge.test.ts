import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock logger ───────────────────────────────────────────────────
vi.mock('../utils/logger.js', () => {
  const { AsyncLocalStorage } = require('node:async_hooks');
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    logContext: new AsyncLocalStorage(),
  };
});

// ── Mock agentFiles ───────────────────────────────────────────────
vi.mock('../agents/agentFiles.js', () => ({
  agentFlagForRole: (roleId: string) => roleId,
}));

// ── Mock RoleFileWriter ──────────────────────────────────────────
const mockWriteRoleFiles = vi.fn().mockResolvedValue(['/test/.github/agents/flightdeck-developer.agent.md']);

vi.mock('../adapters/RoleFileWriter.js', () => ({
  createRoleFileWriter: vi.fn(() => ({
    writeRoleFiles: mockWriteRoleFiles,
  })),
  listRoleFileWriterProviders: vi.fn(() => ['copilot', 'gemini', 'claude', 'cursor', 'codex', 'opencode']),
}));

// ── Mock AdapterFactory ───────────────────────────────────────
const mockStart = vi.fn();
const mockOn = vi.fn();
const mockTerminate = vi.fn().mockResolvedValue(undefined);
const mockPrompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
const mockCancel = vi.fn().mockResolvedValue(undefined);

const mockAdapter: Record<string, any> = {
  start: mockStart,
  on: mockOn,
  terminate: mockTerminate,
  prompt: mockPrompt,
  cancel: mockCancel,
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
      cliArgs: [
        ...(config.cliArgs ?? []),
        ...(agentOpts.agentFlag ? [`--agent=${agentOpts.agentFlag}`] : []),
        ...(config.model ? ['--model', config.model] : []),
      ],
      cwd: agentOpts.cwd ?? process.cwd(),
      sessionId: agentOpts.sessionId,
      model: config.model,
    },
    modelResolution: config.model ? { model: config.model, translated: false, original: config.model } : undefined,
  })),
}));

// Import AFTER mocking
import { startAcp } from '../agents/AgentAcpBridge.js';
import { createRoleFileWriter } from '../adapters/RoleFileWriter.js';
import { logger } from '../utils/logger.js';
import type { ServerConfig } from '../config.js';

// ── Helpers ───────────────────────────────────────────────────────

function createFakeAgent(overrides: Record<string, any> = {}) {
  const fake = {
    id: 'agent-12345678-abcd',
    role: { id: 'lead', name: 'Project Lead', description: 'Leads the project', model: undefined, systemPrompt: 'You are a lead.' },
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
    get isResuming() { return this._phase === 'resuming'; },
    _setResuming() { this._phase = 'resuming'; },
    _finishResuming() { if (this._phase === 'resuming') this._phase = 'idle'; },
    get _isTerminated() { return this._phase === 'stopped' || this._phase === 'error'; },
    _setAcpConnection: vi.fn(),
    _notifyExit: vi.fn(),
    _notifySessionReady: vi.fn(),
    _notifyModelFallback: vi.fn(),
    _notifyStatusChange: vi.fn(),
    _notifyUsage: vi.fn(),
    _notifyContextCompacted: vi.fn(),
    buildFullPrompt: vi.fn(() => 'You are a lead.\n\n[context]\n\nYour task: do the thing'),
    inputTokens: 0,
    outputTokens: 0,
    dagTaskId: undefined as string | undefined,
    systemPaused: false,
    pendingMessageCount: 0,
    contextWindowSize: 0,
    contextWindowUsed: 0,
    _drainOneMessage: vi.fn(),
    queueMessage: vi.fn(),
    recordTokenSample: vi.fn(),
    ...overrides,
  } as any;
  return fake;
}

const fakeConfig: ServerConfig = {
  port: 3001,
  host: '127.0.0.1',
  cliCommand: 'copilot',
  cliArgs: [],
  provider: 'copilot',
  maxConcurrentAgents: 50,
  dbPath: './test.db',
};

describe('AgentAcpBridge — startAcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.isPrompting = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the actual error message when ACP start fails', async () => {
    const agent = createFakeAgent();
    const startError = new Error('CLI binary "copilot" not found in PATH. Install the provider CLI or set the binary path in your config.');
    mockStart.mockRejectedValue(startError);

    startAcp(agent, fakeConfig);

    // Wait for the catch handler to execute
    await vi.waitFor(() => {
      expect(agent._notifyExit).toHaveBeenCalledWith(1);
    });

    // The error should be logged with details, NOT swallowed
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'agent-bridge',
        msg: 'Adapter start failed',
        cliCommand: 'copilot',
        cwd: '/test/project',
        role: 'lead',
      }),
    );

    // Verify the actual error message is included in the log
    const errorCall = (logger.error as any).mock.calls.find(
      (call: any[]) => call[0]?.msg === 'Adapter start failed',
    );
    expect(errorCall[0].err).toContain('not found in PATH');
  });

  it('sets agent status to failed on error', async () => {
    const agent = createFakeAgent();
    mockStart.mockRejectedValue(new Error('connection refused'));

    startAcp(agent, fakeConfig);

    await vi.waitFor(() => {
      expect(agent._notifyExit).toHaveBeenCalled();
    });

    expect(agent.status).toBe('failed');
  });

  it('handles null/undefined error gracefully', async () => {
    const agent = createFakeAgent();
    mockStart.mockRejectedValue(null);

    startAcp(agent, fakeConfig);

    await vi.waitFor(() => {
      expect(agent._notifyExit).toHaveBeenCalledWith(1);
    });

    // Should not throw, should still log something
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'agent-bridge',
        msg: 'Adapter start failed',
      }),
    );
  });

  it('includes agent ID prefix in error log', async () => {
    const agent = createFakeAgent({ id: 'abcdef12-3456-7890-xxxx' });
    mockStart.mockRejectedValue(new Error('timeout'));

    startAcp(agent, fakeConfig);

    await vi.waitFor(() => {
      expect(agent._notifyExit).toHaveBeenCalled();
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'agent-bridge',
        msg: 'Adapter start failed',
        err: 'timeout',
      }),
    );
  });

  it('notifies status change to running when bridge starts', async () => {
    const agent = createFakeAgent();
    mockStart.mockResolvedValue('session-123');

    await startAcp(agent, fakeConfig);

    // The bridge sets status to 'running' and notifies before conn.start(),
    // then conn.start() resolving may set it to 'idle' (resumed) or keep running.
    // We verify the notification was fired with 'running' at bridge init time.
    expect(agent._notifyStatusChange).toHaveBeenCalledWith('running');
    // 'running' should be the first notification call
    expect(agent._notifyStatusChange.mock.calls[0][0]).toBe('running');
  });

  it('passes correct cliArgs to AcpConnection.start', async () => {
    const agent = createFakeAgent({ model: 'claude-sonnet-4' });
    mockStart.mockResolvedValue('session-123');

    await startAcp(agent, fakeConfig);

    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        cliCommand: 'copilot',
        cwd: '/test/project',
        cliArgs: expect.arrayContaining(['--agent=lead', '--model', 'claude-sonnet-4']),
      }),
    );
  });

  it('terminates adapter on start failure to prevent orphan processes', async () => {
    const agent = createFakeAgent();
    mockStart.mockRejectedValue(new Error('spawn failed'));

    startAcp(agent, fakeConfig);

    await vi.waitFor(() => {
      expect(agent._notifyExit).toHaveBeenCalledWith(1);
    });

    expect(mockTerminate).toHaveBeenCalled();
  });

  it('writes role files before spawning the adapter', async () => {
    const agent = createFakeAgent({
      role: { id: 'developer', name: 'Developer', description: 'Writes code', systemPrompt: 'You are a developer.' },
    });
    mockStart.mockResolvedValue('session-456');

    await startAcp(agent, fakeConfig);

    expect(createRoleFileWriter).toHaveBeenCalledWith('copilot');
    expect(mockWriteRoleFiles).toHaveBeenCalledWith(
      [{ role: 'developer', description: 'Writes code', instructions: 'You are a developer.' }],
      '/test/project',
    );

    // Role files should be written BEFORE conn.start()
    const writeOrder = mockWriteRoleFiles.mock.invocationCallOrder[0];
    const startOrder = mockStart.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(startOrder);
  });

  it('writes role files for gemini provider', async () => {
    const agent = createFakeAgent({
      provider: 'gemini',
      role: { id: 'architect', name: 'Architect', description: 'System design', systemPrompt: 'You are an architect.' },
    });
    mockStart.mockResolvedValue('session-789');

    await startAcp(agent, { ...fakeConfig, provider: 'gemini' });

    expect(createRoleFileWriter).toHaveBeenCalledWith('gemini');
    expect(mockWriteRoleFiles).toHaveBeenCalledWith(
      [{ role: 'architect', description: 'System design', instructions: 'You are an architect.' }],
      '/test/project',
    );
  });

  it('continues startup if role file writing fails', async () => {
    const agent = createFakeAgent();
    mockWriteRoleFiles.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    mockStart.mockResolvedValue('session-ok');

    await startAcp(agent, fakeConfig);

    // Should log a warning but NOT fail
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'agent-bridge',
        msg: expect.stringContaining('Role file write failed'),
      }),
    );

    // Adapter start should still have been called
    expect(mockStart).toHaveBeenCalled();
  });

  it('sets agent idle on successful resume (no initialPrompt)', async () => {
    const agent = createFakeAgent({
      resumeSessionId: 'valid-session-id',
      _resuming: true,
    });
    mockStart.mockResolvedValue('valid-session-id');

    startAcp(agent, fakeConfig);

    await vi.waitFor(() => {
      expect(agent._notifySessionReady).toHaveBeenCalledWith('valid-session-id');
    });

    // Should NOT prompt — successful resume waits for input
    expect(mockPrompt).not.toHaveBeenCalled();

    // Should be idle
    expect(agent.status).toBe('idle');
    expect(agent.isResuming).toBe(false);
  });

  // ── Helper to get registered event handlers from mockOn ──────────
  function getEventHandler(eventName: string): ((...args: any[]) => void) | undefined {
    const call = mockOn.mock.calls.find((c: any[]) => c[0] === eventName);
    return call ? call[1] : undefined;
  }

  describe('prompt_complete — no estimation fallback', () => {
    it('does NOT notify usage on prompt_complete even when no real usage data arrived', async () => {
      const agent = createFakeAgent({
        inputTokens: 0,
        outputTokens: 0,
      });
      agent._phase = 'running';
      mockStart.mockResolvedValue('session-123');
      mockAdapter.isPrompting = false;
      mockAdapter.flushSystemNotes = vi.fn().mockReturnValue(null);

      await startAcp(agent, fakeConfig);

      const handler = getEventHandler('prompt_complete');
      expect(handler).toBeDefined();
      handler!('end_turn');

      // No estimation fallback — _notifyUsage should NOT be called from prompt_complete
      expect(agent._notifyUsage).not.toHaveBeenCalled();
    });

    it('does NOT notify usage on prompt_complete even when agent has token counts', async () => {
      const agent = createFakeAgent({
        inputTokens: 500,
        outputTokens: 1200,
      });
      agent._phase = 'running';
      mockStart.mockResolvedValue('session-123');
      mockAdapter.isPrompting = false;
      mockAdapter.flushSystemNotes = vi.fn().mockReturnValue(null);

      await startAcp(agent, fakeConfig);

      const handler = getEventHandler('prompt_complete');
      handler!('end_turn');

      // Real usage was already notified via the 'usage' event, not prompt_complete
      expect(agent._notifyUsage).not.toHaveBeenCalled();
    });
  });

  describe('usage_update — cost field', () => {
    it('accepts cost field in usage_update without error', async () => {
      const agent = createFakeAgent();
      agent._phase = 'running';
      mockStart.mockResolvedValue('session-123');
      mockAdapter.flushSystemNotes = vi.fn().mockReturnValue(null);

      await startAcp(agent, fakeConfig);

      const handler = getEventHandler('usage_update');
      expect(handler).toBeDefined();

      // Should not throw when cost is provided
      expect(() => handler!({ size: 128000, used: 45000, cost: 0.0032 })).not.toThrow();
      expect(agent.contextWindowSize).toBe(128000);
      expect(agent.contextWindowUsed).toBe(45000);
    });
  });
});
