import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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

const mockAdapter = {
  start: mockStart,
  on: mockOn,
  terminate: mockTerminate,
  type: 'acp',
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
  return {
    id: 'agent-12345678-abcd',
    role: { id: 'lead', name: 'Project Lead', description: 'Leads the project', model: undefined, systemPrompt: 'You are a lead.' },
    autopilot: true,
    model: undefined,
    resumeSessionId: undefined,
    cwd: '/test/project',
    status: 'idle',
    sessionId: undefined,
    _setAcpConnection: vi.fn(),
    _notifyExit: vi.fn(),
    _notifySessionReady: vi.fn(),
    _notifyModelFallback: vi.fn(),
    _notifyStatusChange: vi.fn(),
    ...overrides,
  } as any;
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

  it('passes correct cliArgs to AcpConnection.start', async () => {
    const agent = createFakeAgent({ model: 'claude-sonnet-4-5' });
    mockStart.mockResolvedValue('session-123');

    await startAcp(agent, fakeConfig);

    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        cliCommand: 'copilot',
        cwd: '/test/project',
        cliArgs: expect.arrayContaining(['--agent=lead', '--model', 'claude-sonnet-4-5']),
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
});
