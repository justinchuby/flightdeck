/**
 * AgentServerRecovery tests.
 *
 * Tests the recovery logic using mocked persistence and adapter factory.
 * Verifies that agents are correctly classified as resumed, stale, or failed
 * based on provider capabilities and resume outcomes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentServerRecovery } from '../agents/AgentServerRecovery.js';
import type { AgentServerPersistence } from '../agent-server-persistence.js';
import type { AgentRecord } from '../db/AgentRosterRepository.js';

// ── Mocks ───────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: overrides.agentId ?? 'agent-1',
    role: overrides.role ?? 'developer',
    model: overrides.model ?? 'claude-sonnet',
    status: overrides.status ?? 'idle',
    sessionId: 'sessionId' in overrides ? overrides.sessionId : 'session-abc',
    projectId: overrides.projectId ?? 'proj-1',
    teamId: overrides.teamId ?? 'default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastTaskSummary: overrides.lastTaskSummary,
    metadata: overrides.metadata,
  };
}

function mockPersistence(agents: AgentRecord[] = []): AgentServerPersistence {
  return {
    getActiveAgents: vi.fn().mockReturnValue(agents),
    onAgentSpawned: vi.fn(),
    onSessionReady: vi.fn(),
    onStatusChanged: vi.fn(),
    onAgentExited: vi.fn(),
    onAgentTerminated: vi.fn(),
    onServerStop: vi.fn(),
  } as unknown as AgentServerPersistence;
}

// Mock adapter factory — we need to mock the module
vi.mock('../adapters/AdapterFactory.js', () => ({
  createAdapterForProvider: vi.fn(),
  buildStartOptions: vi.fn().mockReturnValue({ cliCommand: 'mock', cwd: '/tmp' }),
}));

// Mock presets — control supportsResume per test
vi.mock('../adapters/presets.js', () => ({
  getPreset: vi.fn(),
}));

import { createAdapterForProvider } from '../adapters/AdapterFactory.js';
import { getPreset } from '../adapters/presets.js';

const mockCreateAdapter = vi.mocked(createAdapterForProvider);
const mockGetPreset = vi.mocked(getPreset);

function makeAdapter(sessionId: string = 'new-session-123') {
  return {
    start: vi.fn().mockResolvedValue(sessionId),
    prompt: vi.fn(),
    cancel: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AgentServerRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPreset.mockReturnValue({
      id: 'copilot',
      name: 'GitHub Copilot',
      binary: 'gh',
      args: ['copilot', 'agent'],
      transport: 'stdio',
      capabilities: { streaming: true },
      supportsResume: true,
    } as any);
  });

  describe('recover with no agents', () => {
    it('returns empty report when no agents to recover', async () => {
      const persistence = mockPersistence([]);
      const recovery = new AgentServerRecovery(persistence);

      const report = await recovery.recover();

      expect(report.total).toBe(0);
      expect(report.resumed).toEqual([]);
      expect(report.stale).toEqual([]);
      expect(report.failed).toEqual([]);
    });
  });

  describe('successful resume', () => {
    it('resumes agent with session ID when provider supports it', async () => {
      const record = makeRecord({ agentId: 'agent-resume-1', sessionId: 'session-old' });
      const persistence = mockPersistence([record]);
      const adapter = makeAdapter('session-new');
      mockCreateAdapter.mockReturnValue({ adapter, backend: 'acp', fallback: false } as any);

      const recovery = new AgentServerRecovery(persistence);
      const report = await recovery.recover();

      expect(report.total).toBe(1);
      expect(report.resumed.length).toBe(1);
      expect(report.resumed[0].agentId).toBe('agent-resume-1');
      expect(report.resumed[0].status).toBe('resumed');
      expect(report.resumed[0].sessionId).toBe('session-new');
      expect(report.resumed[0].adapter).toBe(adapter);
    });

    it('updates persistence with new session and running status', async () => {
      const record = makeRecord({ agentId: 'agent-persist-1' });
      const persistence = mockPersistence([record]);
      const adapter = makeAdapter('new-session-xyz');
      mockCreateAdapter.mockReturnValue({ adapter, backend: 'acp', fallback: false } as any);

      const recovery = new AgentServerRecovery(persistence);
      await recovery.recover();

      expect(persistence.onSessionReady).toHaveBeenCalledWith('agent-persist-1', 'new-session-xyz');
      expect(persistence.onStatusChanged).toHaveBeenCalledWith('agent-persist-1', 'running');
    });

    it('resumes multiple agents in parallel', async () => {
      const records = [
        makeRecord({ agentId: 'multi-1', sessionId: 'sess-1' }),
        makeRecord({ agentId: 'multi-2', sessionId: 'sess-2' }),
        makeRecord({ agentId: 'multi-3', sessionId: 'sess-3' }),
      ];
      const persistence = mockPersistence(records);
      mockCreateAdapter.mockReturnValue({
        adapter: makeAdapter(),
        backend: 'acp',
        fallback: false,
      } as any);

      const recovery = new AgentServerRecovery(persistence);
      const report = await recovery.recover();

      expect(report.total).toBe(3);
      expect(report.resumed.length).toBe(3);
    });
  });

  describe('stale agents', () => {
    it('marks agent as stale when provider does not support resume', async () => {
      mockGetPreset.mockReturnValue({
        id: 'gemini',
        name: 'Gemini',
        binary: 'gemini',
        args: [],
        transport: 'stdio',
        capabilities: {},
        supportsResume: false,
      } as any);

      const record = makeRecord({ agentId: 'stale-1', sessionId: 'old-session' });
      const persistence = mockPersistence([record]);

      const recovery = new AgentServerRecovery(persistence, { adapterConfig: { provider: 'gemini' } });
      const report = await recovery.recover();

      expect(report.stale.length).toBe(1);
      expect(report.stale[0].agentId).toBe('stale-1');
      expect(report.stale[0].error).toContain('does not support session resume');
    });

    it('marks agent as stale when no sessionId available', async () => {
      const record = makeRecord({ agentId: 'stale-2', sessionId: undefined });
      const persistence = mockPersistence([record]);

      const recovery = new AgentServerRecovery(persistence);
      const report = await recovery.recover();

      expect(report.stale.length).toBe(1);
      expect(report.stale[0].agentId).toBe('stale-2');
      expect(report.stale[0].error).toContain('No sessionId');
    });

    it('updates persistence for stale agents', async () => {
      const record = makeRecord({ agentId: 'stale-persist', sessionId: undefined });
      const persistence = mockPersistence([record]);

      const recovery = new AgentServerRecovery(persistence);
      await recovery.recover();

      expect(persistence.onStatusChanged).toHaveBeenCalledWith('stale-persist', 'exited');
    });
  });

  describe('failed resume', () => {
    it('marks agent as failed when adapter start throws', async () => {
      const record = makeRecord({ agentId: 'fail-1', sessionId: 'sess-1' });
      const persistence = mockPersistence([record]);
      const adapter = makeAdapter();
      adapter.start.mockRejectedValue(new Error('Session expired'));
      mockCreateAdapter.mockReturnValue({ adapter, backend: 'acp', fallback: false } as any);

      const recovery = new AgentServerRecovery(persistence);
      const report = await recovery.recover();

      expect(report.failed.length).toBe(1);
      expect(report.failed[0].agentId).toBe('fail-1');
      expect(report.failed[0].error).toBe('Session expired');
    });

    it('marks agent as failed when adapter creation throws', async () => {
      const record = makeRecord({ agentId: 'fail-2', sessionId: 'sess-2' });
      const persistence = mockPersistence([record]);
      mockCreateAdapter.mockImplementation(() => { throw new Error('No adapter available'); });

      const recovery = new AgentServerRecovery(persistence);
      const report = await recovery.recover();

      expect(report.failed.length).toBe(1);
      expect(report.failed[0].error).toBe('No adapter available');
    });

    it('updates persistence to crashed status on failure', async () => {
      const record = makeRecord({ agentId: 'fail-persist' });
      const persistence = mockPersistence([record]);
      const adapter = makeAdapter();
      adapter.start.mockRejectedValue(new Error('Connection refused'));
      mockCreateAdapter.mockReturnValue({ adapter, backend: 'acp', fallback: false } as any);

      const recovery = new AgentServerRecovery(persistence);
      await recovery.recover();

      expect(persistence.onStatusChanged).toHaveBeenCalledWith('fail-persist', 'crashed');
    });
  });

  describe('mixed results', () => {
    it('correctly categorizes a mix of resumed, stale, and failed agents', async () => {
      const records = [
        makeRecord({ agentId: 'ok-1', sessionId: 'sess-1' }),
        makeRecord({ agentId: 'no-sess', sessionId: undefined }),
        makeRecord({ agentId: 'fail-1', sessionId: 'sess-3' }),
      ];
      const persistence = mockPersistence(records);

      // First call succeeds, second is stale (no session), third fails
      let callCount = 0;
      mockCreateAdapter.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { adapter: makeAdapter('new-sess'), backend: 'acp', fallback: false } as any;
        }
        // Third agent (callCount === 2, since stale doesn't call factory)
        const failAdapter = makeAdapter();
        failAdapter.start.mockRejectedValue(new Error('Timed out'));
        return { adapter: failAdapter, backend: 'acp', fallback: false } as any;
      });

      const recovery = new AgentServerRecovery(persistence);
      const report = await recovery.recover();

      expect(report.total).toBe(3);
      expect(report.resumed.length).toBe(1);
      expect(report.stale.length).toBe(1);
      expect(report.failed.length).toBe(1);

      expect(report.resumed[0].agentId).toBe('ok-1');
      expect(report.stale[0].agentId).toBe('no-sess');
      expect(report.failed[0].agentId).toBe('fail-1');
    });
  });

  describe('edge cases', () => {
    it('handles unknown provider gracefully', async () => {
      mockGetPreset.mockReturnValue(undefined as any);

      const record = makeRecord({ agentId: 'unknown-provider', sessionId: 'sess' });
      const persistence = mockPersistence([record]);

      const recovery = new AgentServerRecovery(persistence, { adapterConfig: { provider: 'unknown' } });
      const report = await recovery.recover();

      // null preset → supportsResume defaults to false → stale
      expect(report.stale.length).toBe(1);
    });

    it('passes adapter config through to factory', async () => {
      const record = makeRecord({ agentId: 'config-test', sessionId: 'sess', model: 'claude-opus' });
      const persistence = mockPersistence([record]);
      const adapter = makeAdapter();
      mockCreateAdapter.mockReturnValue({ adapter, backend: 'acp', fallback: false } as any);

      const recovery = new AgentServerRecovery(persistence, {
        adapterConfig: { provider: 'copilot', sdkMode: true },
      });
      await recovery.recover();

      expect(mockCreateAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'copilot', sdkMode: true, model: 'claude-opus' }),
      );
    });
  });
});
