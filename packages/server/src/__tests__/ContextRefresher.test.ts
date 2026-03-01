import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextRefresher } from '../coordination/ContextRefresher.js';
import { EventEmitter } from 'events';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'agent-1',
    role: overrides.role ?? { id: 'dev', name: 'Developer' },
    status: overrides.status ?? 'running',
    task: overrides.task ?? 'task-1',
    injectContextUpdate: vi.fn(),
    ...overrides,
  };
}

function makeLock(agentId: string, filePath: string) {
  return {
    filePath,
    agentId,
    agentRole: 'dev',
    reason: 'editing',
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function createMocks() {
  const agentManager = Object.assign(new EventEmitter(), {
    getAll: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  });
  const lockRegistry = Object.assign(new EventEmitter(), {
    getByAgent: vi.fn().mockReturnValue([]),
    getAll: vi.fn().mockReturnValue([]),
  });
  const activityLedger = {
    getRecent: vi.fn().mockReturnValue([]),
    getSince: vi.fn().mockReturnValue([]),
  };
  return { agentManager, lockRegistry, activityLedger };
}

describe('ContextRefresher', () => {
  let mocks: ReturnType<typeof createMocks>;
  let refresher: ContextRefresher;

  beforeEach(() => {
    mocks = createMocks();
    refresher = new ContextRefresher(
      mocks.agentManager as any,
      mocks.lockRegistry as any,
      mocks.activityLedger as any,
    );
  });

  afterEach(() => {
    refresher.stop();
  });

  describe('buildPeerList', () => {
    it('returns correct AgentContextInfo array from agents', () => {
      const agents = [
        makeAgent({ id: 'a1', role: { id: 'dev', name: 'Developer' }, status: 'running', task: 't1' }),
        makeAgent({ id: 'a2', role: { id: 'qa', name: 'QA Engineer' }, status: 'completed', task: 't2' }),
      ];
      mocks.agentManager.getAll.mockReturnValue(agents);
      mocks.lockRegistry.getAll.mockReturnValue([]);

      const peers = refresher.buildPeerList();

      expect(peers).toHaveLength(2);
      expect(peers[0]).toEqual({
        id: 'a1',
        role: 'dev',
        roleName: 'Developer',
        status: 'running',
        task: 't1',
        lockedFiles: [],
      });
      expect(peers[1]).toEqual({
        id: 'a2',
        role: 'qa',
        roleName: 'QA Engineer',
        status: 'completed',
        task: 't2',
        lockedFiles: [],
      });
    });

    it('includes locked files from FileLockRegistry', () => {
      const agents = [
        makeAgent({ id: 'a1' }),
        makeAgent({ id: 'a2' }),
      ];
      mocks.agentManager.getAll.mockReturnValue(agents);
      mocks.lockRegistry.getAll.mockReturnValue([
        makeLock('a1', 'src/index.ts'),
        makeLock('a1', 'src/utils.ts'),
        makeLock('a2', 'src/main.ts'),
      ]);

      const peers = refresher.buildPeerList();

      expect(peers[0]!.lockedFiles).toEqual(['src/index.ts', 'src/utils.ts']);
      expect(peers[1]!.lockedFiles).toEqual(['src/main.ts']);
    });
  });

  describe('buildRecentActivity', () => {
    it('formats activity entries as readable strings', () => {
      const entries = [
        {
          id: 1,
          agentId: 'abcdefgh-1234-5678-9012-abcdefghijkl',
          agentRole: 'Developer',
          actionType: 'file_edit' as const,
          summary: 'Edited src/index.ts',
          details: {},
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          agentId: '12345678-abcd-efgh-ijkl-123456789012',
          agentRole: 'QA',
          actionType: 'test_run' as const,
          summary: 'Ran tests',
          details: {},
          timestamp: '2024-01-01T00:01:00Z',
        },
      ];
      mocks.activityLedger.getRecent.mockReturnValue(entries);

      const result = refresher.buildRecentActivity();

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(
        '[2024-01-01T00:00:00Z] Agent abcdefgh (Developer): file_edit — Edited src/index.ts',
      );
      expect(result[1]).toBe(
        '[2024-01-01T00:01:00Z] Agent 12345678 (QA): test_run — Ran tests',
      );
      expect(mocks.activityLedger.getRecent).toHaveBeenCalledWith(20);
    });
  });

  describe('refreshAll', () => {
    it('calls injectContextUpdate on all running agents', () => {
      const a1 = makeAgent({ id: 'a1', status: 'running' });
      const a2 = makeAgent({ id: 'a2', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([a1, a2]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.refreshAll();

      expect(a1.injectContextUpdate).toHaveBeenCalledTimes(1);
      expect(a2.injectContextUpdate).toHaveBeenCalledTimes(1);
      // Each agent should receive peers excluding itself
      const a1Peers = a1.injectContextUpdate.mock.calls[0][0];
      expect(a1Peers.every((p: any) => p.id !== 'a1')).toBe(true);
      const a2Peers = a2.injectContextUpdate.mock.calls[0][0];
      expect(a2Peers.every((p: any) => p.id !== 'a2')).toBe(true);
    });

    it('skips non-running agents (completed/failed)', () => {
      const running = makeAgent({ id: 'r1', status: 'running' });
      const completed = makeAgent({ id: 'c1', status: 'completed' });
      const failed = makeAgent({ id: 'f1', status: 'failed' });
      mocks.agentManager.getAll.mockReturnValue([running, completed, failed]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.refreshAll();

      expect(running.injectContextUpdate).toHaveBeenCalledTimes(1);
      expect(completed.injectContextUpdate).not.toHaveBeenCalled();
      expect(failed.injectContextUpdate).not.toHaveBeenCalled();
    });
  });

  describe('refreshOne', () => {
    it('only refreshes the specified agent', () => {
      const a1 = makeAgent({ id: 'a1', status: 'running' });
      const a2 = makeAgent({ id: 'a2', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([a1, a2]);
      mocks.agentManager.get.mockImplementation((id: string) => {
        if (id === 'a1') return a1;
        if (id === 'a2') return a2;
        return undefined;
      });
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.refreshOne('a1');

      expect(a1.injectContextUpdate).toHaveBeenCalledTimes(1);
      expect(a2.injectContextUpdate).not.toHaveBeenCalled();
      // Peers should exclude the refreshed agent
      const peers = a1.injectContextUpdate.mock.calls[0][0];
      expect(peers.every((p: any) => p.id !== 'a1')).toBe(true);
    });

    it('does nothing for non-running agents', () => {
      const agent = makeAgent({ id: 'a1', status: 'completed' });
      mocks.agentManager.get.mockReturnValue(agent);

      refresher.refreshOne('a1');

      expect(agent.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('does nothing for unknown agent id', () => {
      mocks.agentManager.get.mockReturnValue(undefined);

      refresher.refreshOne('unknown');
      // No error thrown
    });
  });

  describe('start and stop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('start sets up periodic timer but only refreshes receivesStatusUpdates roles', () => {
      const a1 = makeAgent({ id: 'a1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([a1]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.start();

      // Regular agents (no receivesStatusUpdates) are not refreshed by periodic timer
      vi.advanceTimersByTime(60000);
      expect(a1.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('stop clears any pending debounce', () => {
      const a1 = makeAgent({ id: 'a1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([a1]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.start();
      // Trigger debounced refresh via event
      mocks.agentManager.emit('agent:spawned', {});
      refresher.stop();
      vi.advanceTimersByTime(10000);
      // Debounce was cleared — no calls
      expect(a1.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('start can be called multiple times safely', () => {
      refresher.start();
      refresher.start();
      // No error thrown
    });

    it('stop clears the periodic timer', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      mocks.agentManager.getAll.mockReturnValue([secretary]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.start();
      refresher.stop();
      vi.advanceTimersByTime(120000);
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();
    });
  });

  describe('periodic status updates', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends periodic updates to secretary (receivesStatusUpdates) agents', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      const dev = makeAgent({ id: 'd1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([secretary, dev]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.start();
      vi.advanceTimersByTime(60000);

      // Secretary gets periodic update
      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
      // Dev does NOT get periodic update
      expect(dev.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('secretary receives health header in refreshAll', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      mocks.agentManager.getAll.mockReturnValue([secretary]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
      const healthHeader = secretary.injectContextUpdate.mock.calls[0][2];
      expect(healthHeader).toBeDefined();
      expect(healthHeader).toContain('PROJECT HEALTH');
    });

    it('lead receives health header scoped to children', () => {
      const lead = makeAgent({
        id: 'lead-1',
        status: 'running',
        role: { id: 'lead', name: 'Project Lead', receivesStatusUpdates: true },
      });
      const child = makeAgent({
        id: 'd1',
        status: 'running',
        parentId: 'lead-1',
      });
      mocks.agentManager.getAll.mockReturnValue([lead, child]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      expect(lead.injectContextUpdate).toHaveBeenCalledTimes(1);
      const healthHeader = lead.injectContextUpdate.mock.calls[0][2];
      expect(healthHeader).toContain('PROJECT HEALTH');
      expect(healthHeader).toContain('1 active');
    });

    it('regular dev does not receive health header', () => {
      const dev = makeAgent({ id: 'd1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([dev]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.refreshAll();

      expect(dev.injectContextUpdate).toHaveBeenCalledTimes(1);
      const healthHeader = dev.injectContextUpdate.mock.calls[0][2];
      expect(healthHeader).toBeUndefined();
    });
  });

  describe('buildPeerList reflects latest task after re-delegation', () => {
    it('shows updated task text when agent.task is changed', () => {
      const agent = makeAgent({ id: 'a1', task: 'Original task from CREATE_AGENT' });
      mocks.agentManager.getAll.mockReturnValue([agent]);
      mocks.lockRegistry.getAll.mockReturnValue([]);

      // Initial buildPeerList shows original task
      let peers = refresher.buildPeerList();
      expect(peers[0]!.task).toBe('Original task from CREATE_AGENT');

      // Simulate DELEGATE updating the task (child.task = req.task)
      agent.task = 'New task after re-delegation';
      peers = refresher.buildPeerList();
      expect(peers[0]!.task).toBe('New task after re-delegation');
    });

    it('CREW_UPDATE sent to other agents shows re-delegated task', () => {
      const lead = makeAgent({
        id: 'lead-1',
        role: { id: 'lead', name: 'Project Lead' },
        status: 'running',
        task: 'Coordinate project',
      });
      const dev = makeAgent({
        id: 'dev-1',
        status: 'running',
        task: 'Original dev task',
        parentId: 'lead-1',
      });
      mocks.agentManager.getAll.mockReturnValue([lead, dev]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.refreshAll();

      // Lead's CREW_UPDATE shows dev with original task
      const leadCall1 = lead.injectContextUpdate.mock.calls[0];
      const devPeer1 = leadCall1[0].find((p: any) => p.id === 'dev-1');
      expect(devPeer1.task).toBe('Original dev task');

      // Simulate re-delegation
      dev.task = 'Re-delegated task';
      lead.injectContextUpdate.mockClear();

      refresher.refreshAll();

      // Lead's CREW_UPDATE now shows dev with new task
      const leadCall2 = lead.injectContextUpdate.mock.calls[0];
      const devPeer2 = leadCall2[0].find((p: any) => p.id === 'dev-1');
      expect(devPeer2.task).toBe('Re-delegated task');
    });
  });
});
