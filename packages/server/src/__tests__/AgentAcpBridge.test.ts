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

// ── Mock AdapterFactory ───────────────────────────────────────
const mockStart = vi.fn();
const mockOn = vi.fn();

const mockAdapter = {
  start: mockStart,
  on: mockOn,
  type: 'acp',
};

vi.mock('../adapters/AdapterFactory.js', () => ({
  createAdapterForProvider: vi.fn(() => ({
    adapter: mockAdapter,
    backend: 'acp',
    fallback: false,
  })),
  buildStartOptions: vi.fn((config: any, agentOpts: any) => ({
    cliCommand: config.binaryOverride || config.cliCommand || 'copilot',
    cliArgs: [
      ...(config.cliArgs ?? []),
      ...(agentOpts.agentFlag ? [`--agent=${agentOpts.agentFlag}`] : []),
      ...(config.model ? ['--model', config.model] : []),
      ...(agentOpts.sessionId ? ['--resume', agentOpts.sessionId] : []),
    ],
    cwd: agentOpts.cwd ?? process.cwd(),
    sessionId: agentOpts.sessionId,
    model: config.model,
  })),
}));

// Import AFTER mocking
import { startAcp } from '../agents/AgentAcpBridge.js';
import { logger } from '../utils/logger.js';
import type { ServerConfig } from '../config.js';

// ── Helpers ───────────────────────────────────────────────────────

function createFakeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-12345678-abcd',
    role: { id: 'lead', name: 'Project Lead', model: undefined, systemPrompt: '' },
    autopilot: true,
    model: undefined,
    resumeSessionId: undefined,
    cwd: '/test/project',
    status: 'idle',
    sessionId: undefined,
    _setAcpConnection: vi.fn(),
    _notifyExit: vi.fn(),
    _notifySessionReady: vi.fn(),
    ...overrides,
  } as any;
}

const fakeConfig: ServerConfig = {
  port: 3001,
  host: '127.0.0.1',
  cliCommand: 'copilot',
  cliArgs: [],
  provider: 'copilot',
  sdkMode: false,
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

  it('passes correct cliArgs to AcpConnection.start', () => {
    const agent = createFakeAgent({ model: 'claude-sonnet-4' });
    mockStart.mockResolvedValue('session-123');

    startAcp(agent, fakeConfig);

    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        cliCommand: 'copilot',
        cwd: '/test/project',
        cliArgs: expect.arrayContaining(['--agent=lead', '--model', 'claude-sonnet-4']),
      }),
    );
  });
});
