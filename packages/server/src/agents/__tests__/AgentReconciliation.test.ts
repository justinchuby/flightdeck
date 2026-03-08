import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentReconciliation } from '../AgentReconciliation.js';
import type { ExpectedAgent, ReconciliationReport } from '../AgentReconciliation.js';
import type { AgentServerClient } from '../AgentServerClient.js';
import type { AgentInfo } from '../../transport/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgentInfo(overrides: Partial<AgentInfo> & { agentId: string }): AgentInfo {
  return {
    role: 'developer',
    model: 'gpt-4',
    status: 'running',
    pid: 1234,
    spawnedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeExpected(overrides: Partial<ExpectedAgent> & { agentId: string }): ExpectedAgent {
  return {
    role: 'developer',
    model: 'gpt-4',
    ...overrides,
  };
}

function createMockClient(agents: AgentInfo[] = []): AgentServerClient {
  return {
    list: vi.fn().mockResolvedValue(agents),
  } as unknown as AgentServerClient;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentReconciliation', () => {
  let reconciler: AgentReconciliation;
  let client: AgentServerClient;

  describe('empty states', () => {
    it('returns empty report when no expected and no actual agents', async () => {
      client = createMockClient([]);
      reconciler = new AgentReconciliation(client);

      const report = await reconciler.reconcile([]);

      expect(report.reconnected).toEqual([]);
      expect(report.lost).toEqual([]);
      expect(report.discovered).toEqual([]);
      expect(report.reconciledAt).toBeGreaterThan(0);
    });

    it('returns all expected as lost when agent server is empty', async () => {
      client = createMockClient([]);
      reconciler = new AgentReconciliation(client);

      const expected = [
        makeExpected({ agentId: 'a1' }),
        makeExpected({ agentId: 'a2' }),
      ];
      const report = await reconciler.reconcile(expected);

      expect(report.lost).toEqual(['a1', 'a2']);
      expect(report.reconnected).toEqual([]);
      expect(report.discovered).toEqual([]);
    });

    it('returns all actual as discovered when no expected agents', async () => {
      const agents = [
        makeAgentInfo({ agentId: 'x1', role: 'architect' }),
        makeAgentInfo({ agentId: 'x2', role: 'tester' }),
      ];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const report = await reconciler.reconcile([]);

      expect(report.discovered).toHaveLength(2);
      expect(report.discovered.map((d) => d.agentId)).toEqual(['x1', 'x2']);
      expect(report.reconnected).toEqual([]);
      expect(report.lost).toEqual([]);
    });
  });

  describe('reconnection', () => {
    it('classifies matching agents as reconnected', async () => {
      const agents = [
        makeAgentInfo({ agentId: 'a1', role: 'developer', model: 'gpt-4', status: 'running', sessionId: 'sess-1' }),
      ];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = [makeExpected({ agentId: 'a1', lastSeenEventId: 'evt-42' })];
      const report = await reconciler.reconcile(expected);

      expect(report.reconnected).toHaveLength(1);
      expect(report.reconnected[0]).toEqual({
        agentId: 'a1',
        role: 'developer',
        model: 'gpt-4',
        status: 'running',
        sessionId: 'sess-1',
        lastSeenEventId: 'evt-42',
      });
      expect(report.lost).toEqual([]);
    });

    it('preserves lastSeenEventId from expected agent', async () => {
      const agents = [makeAgentInfo({ agentId: 'a1' })];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = [makeExpected({ agentId: 'a1', lastSeenEventId: 'evt-99' })];
      const report = await reconciler.reconcile(expected);

      expect(report.reconnected[0].lastSeenEventId).toBe('evt-99');
    });

    it('handles undefined lastSeenEventId', async () => {
      const agents = [makeAgentInfo({ agentId: 'a1' })];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = [makeExpected({ agentId: 'a1' })];
      const report = await reconciler.reconcile(expected);

      expect(report.reconnected[0].lastSeenEventId).toBeUndefined();
    });
  });

  describe('terminal status handling', () => {
    it('treats exited agents as lost even if present on server', async () => {
      const agents = [makeAgentInfo({ agentId: 'a1', status: 'exited' })];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = [makeExpected({ agentId: 'a1' })];
      const report = await reconciler.reconcile(expected);

      expect(report.lost).toEqual(['a1']);
      expect(report.reconnected).toEqual([]);
    });

    it('treats crashed agents as lost even if present on server', async () => {
      const agents = [makeAgentInfo({ agentId: 'a1', status: 'crashed' })];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = [makeExpected({ agentId: 'a1' })];
      const report = await reconciler.reconcile(expected);

      expect(report.lost).toEqual(['a1']);
      expect(report.reconnected).toEqual([]);
    });

    it('excludes exited/crashed agents from discovered', async () => {
      const agents = [
        makeAgentInfo({ agentId: 'x1', status: 'exited' }),
        makeAgentInfo({ agentId: 'x2', status: 'crashed' }),
        makeAgentInfo({ agentId: 'x3', status: 'running' }),
      ];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const report = await reconciler.reconcile([]);

      expect(report.discovered).toHaveLength(1);
      expect(report.discovered[0].agentId).toBe('x3');
    });
  });

  describe('mixed scenarios', () => {
    it('handles mix of reconnected, lost, and discovered', async () => {
      const agents = [
        makeAgentInfo({ agentId: 'a1', status: 'running' }),  // expected + running → reconnected
        // a2 is missing → lost
        makeAgentInfo({ agentId: 'x1', status: 'idle' }),     // unexpected → discovered
      ];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = [
        makeExpected({ agentId: 'a1' }),
        makeExpected({ agentId: 'a2' }),
      ];
      const report = await reconciler.reconcile(expected);

      expect(report.reconnected).toHaveLength(1);
      expect(report.reconnected[0].agentId).toBe('a1');
      expect(report.lost).toEqual(['a2']);
      expect(report.discovered).toHaveLength(1);
      expect(report.discovered[0].agentId).toBe('x1');
    });

    it('handles large agent lists efficiently', async () => {
      const agents = Array.from({ length: 100 }, (_, i) =>
        makeAgentInfo({ agentId: `agent-${i}`, status: i % 3 === 0 ? 'idle' : 'running' }),
      );
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const expected = Array.from({ length: 50 }, (_, i) =>
        makeExpected({ agentId: `agent-${i * 2}` }),
      );
      const report = await reconciler.reconcile(expected);

      // 50 expected, all even indices — all present in agents → all reconnected
      expect(report.reconnected).toHaveLength(50);
      // Odd-indexed agents (50 of them) are discovered
      expect(report.discovered).toHaveLength(50);
      expect(report.lost).toEqual([]);
    });
  });

  describe('agent statuses', () => {
    const nonTerminalStatuses = ['starting', 'running', 'idle', 'stopping'];

    for (const status of nonTerminalStatuses) {
      it(`reconnects agent with '${status}' status`, async () => {
        const agents = [makeAgentInfo({ agentId: 'a1', status: status as any })];
        client = createMockClient(agents);
        reconciler = new AgentReconciliation(client);

        const report = await reconciler.reconcile([makeExpected({ agentId: 'a1' })]);
        expect(report.reconnected).toHaveLength(1);
        expect(report.reconnected[0].status).toBe(status);
      });
    }
  });

  describe('discovered agent metadata', () => {
    it('includes task in discovered agents', async () => {
      const agents = [
        makeAgentInfo({ agentId: 'x1', task: 'write tests', role: 'tester', model: 'claude-3' }),
      ];
      client = createMockClient(agents);
      reconciler = new AgentReconciliation(client);

      const report = await reconciler.reconcile([]);

      expect(report.discovered[0]).toEqual({
        agentId: 'x1',
        role: 'tester',
        model: 'claude-3',
        status: 'running',
        sessionId: undefined,
        task: 'write tests',
      });
    });
  });

  describe('client interaction', () => {
    it('calls client.list() exactly once per reconcile', async () => {
      client = createMockClient([]);
      reconciler = new AgentReconciliation(client);

      await reconciler.reconcile([]);
      await reconciler.reconcile([makeExpected({ agentId: 'a1' })]);

      expect(client.list).toHaveBeenCalledTimes(2);
    });

    it('propagates client errors', async () => {
      client = createMockClient([]);
      (client.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection lost'));
      reconciler = new AgentReconciliation(client);

      await expect(reconciler.reconcile([])).rejects.toThrow('connection lost');
    });
  });
});
