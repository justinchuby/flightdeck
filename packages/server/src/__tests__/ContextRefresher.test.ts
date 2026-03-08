import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextRefresher } from '../coordination/agents/ContextRefresher.js';
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
    getByProject: vi.fn().mockReturnValue([]),
    getProjectIdForAgent: vi.fn().mockReturnValue(undefined),
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
      expect(peers[0]).toMatchObject({
        id: 'a1',
        role: 'dev',
        roleName: 'Developer',
        status: 'running',
        task: 't1',
        lockedFiles: [],
        pendingMessages: 0,
        contextWindowSize: 0,
        contextWindowUsed: 0,
      });
      expect(peers[0]!.createdAt).toBeDefined();
      expect(peers[1]).toMatchObject({
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
          id: 2,
          agentId: '12345678-abcd-efgh-ijkl-123456789012',
          agentRole: 'QA',
          actionType: 'test_run' as const,
          summary: 'Ran tests',
          details: {},
          timestamp: '2024-01-01T00:01:00Z',
        },
        {
          id: 1,
          agentId: 'abcdefgh-1234-5678-9012-abcdefghijkl',
          agentRole: 'Developer',
          actionType: 'file_edit' as const,
          summary: 'Edited src/index.ts',
          details: {},
          timestamp: '2024-01-01T00:00:00Z',
        },
      ];
      mocks.activityLedger.getRecent.mockReturnValue(entries);

      const result = refresher.buildRecentActivity();

      expect(result).toHaveLength(2);
      // SmartActivityFilter sorts by id desc (newest first)
      expect(result[0]).toBe(
        '[2024-01-01T00:01:00Z] Agent 12345678 (QA): test_run — Ran tests',
      );
      expect(result[1]).toBe(
        '[2024-01-01T00:00:00Z] Agent abcdefgh (Developer): file_edit — Edited src/index.ts',
      );
      // Fetches 5x the limit to ensure smart filter has enough entries
      expect(mocks.activityLedger.getRecent).toHaveBeenCalledWith(100, undefined);
    });
  });

  describe('refreshAll', () => {
    it('calls injectContextUpdate on running status-receiver agents', () => {
      const a1 = makeAgent({ id: 'a1', status: 'running', role: { id: 'lead', name: 'Lead', receivesStatusUpdates: true } });
      const a2 = makeAgent({ id: 'a2', status: 'running', role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true } });
      mocks.agentManager.getAll.mockReturnValue([a1, a2]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getByLeadId: vi.fn().mockReturnValue([]),
        getAll: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

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
      const running = makeAgent({ id: 'r1', status: 'running', role: { id: 'lead', name: 'Lead', receivesStatusUpdates: true } });
      const completed = makeAgent({ id: 'c1', status: 'completed' });
      const failed = makeAgent({ id: 'f1', status: 'failed' });
      mocks.agentManager.getAll.mockReturnValue([running, completed, failed]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getByLeadId: vi.fn().mockReturnValue([]),
        getAll: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

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

    it('stop prevents further periodic refreshes', () => {
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
      vi.advanceTimersByTime(300000);
      // Periodic refresh was cleared — no calls
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();
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
      const subLead = makeAgent({
        id: 'sub-lead-1',
        status: 'running',
        role: { id: 'lead', name: 'Sub Lead', receivesStatusUpdates: true },
        parentId: 'lead-1',
      });
      const dev = makeAgent({ id: 'd1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([secretary, subLead, dev]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.start();
      // Periodic interval is 180s when sub-leads are active
      vi.advanceTimersByTime(180000);

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

    it('regular dev does not receive refreshAll updates', () => {
      const dev = makeAgent({ id: 'd1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([dev]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.refreshAll();

      // Dev without receivesStatusUpdates is skipped entirely by refreshAll
      expect(dev.injectContextUpdate).not.toHaveBeenCalled();
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
        role: { id: 'lead', name: 'Project Lead', receivesStatusUpdates: true },
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
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

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

  describe('periodic timer policy — sub-lead gated', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends periodic updates at 180s when sub-leads are active', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      const topLead = makeAgent({
        id: 'lead-1',
        status: 'running',
        role: { id: 'lead', name: 'Project Lead', receivesStatusUpdates: true },
      });
      const subLead = makeAgent({
        id: 'sublead-1',
        status: 'running',
        parentId: 'lead-1',
        role: { id: 'lead', name: 'Sub Lead' },
      });
      mocks.agentManager.getAll.mockReturnValue([secretary, topLead, subLead]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.start();

      // At 179s — no update yet
      vi.advanceTimersByTime(179000);
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();

      // At 180s — first update
      vi.advanceTimersByTime(1000);
      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
    });

    it('skips periodic updates when no sub-leads exist', () => {
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

      // Even after 5 minutes, no periodic update (no sub-leads)
      vi.advanceTimersByTime(300000);
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('no periodic updates when all agents are idle (no sub-leads)', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'idle',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      const lead = makeAgent({
        id: 'lead-1',
        status: 'idle',
        role: { id: 'lead', name: 'Project Lead', receivesStatusUpdates: true },
      });
      mocks.agentManager.getAll.mockReturnValue([lead, secretary]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.start();

      vi.advanceTimersByTime(600000);
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();
      expect(lead.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('starts sending updates when a sub-lead appears', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      const topLead = makeAgent({
        id: 'lead-1',
        status: 'running',
        role: { id: 'lead', name: 'Project Lead', receivesStatusUpdates: true },
      });
      // Start without sub-leads
      mocks.agentManager.getAll.mockReturnValue([secretary, topLead]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.start();

      // First 180s — no update (no sub-leads)
      vi.advanceTimersByTime(180000);
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();

      // Add a sub-lead and emit agent:spawned to trigger timer re-evaluation
      const subLead = makeAgent({
        id: 'sublead-1',
        status: 'running',
        parentId: 'lead-1',
        role: { id: 'lead', name: 'Sub Lead' },
      });
      mocks.agentManager.getAll.mockReturnValue([secretary, topLead, subLead]);
      mocks.agentManager.emit('agent:spawned', { id: 'sublead-1' });

      // Debounce (2s) + periodic interval (180s) = update fires
      vi.advanceTimersByTime(2000); // debounce fires refreshAll
      secretary.injectContextUpdate.mockClear(); // clear the refreshAll call
      vi.advanceTimersByTime(180000); // periodic timer fires
      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('event triggers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('agent:spawned triggers debounced refreshAll to status receivers', () => {
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

      // Emit agent:spawned
      mocks.agentManager.emit('agent:spawned', { id: 'new-agent' });

      // Before debounce fires — no update yet
      vi.advanceTimersByTime(1999);
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();

      // After debounce (2s) — refreshAll fires for status receivers
      vi.advanceTimersByTime(1);
      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
      // Dev does NOT receive update (not a status receiver)
      expect(dev.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('agent:context_compacted triggers immediate refreshOne for that agent', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      const dev = makeAgent({ id: 'd1', status: 'running' });
      mocks.agentManager.getAll.mockReturnValue([secretary, dev]);
      mocks.agentManager.get.mockImplementation((id: string) => {
        if (id === 's1') return secretary;
        if (id === 'd1') return dev;
        return undefined;
      });
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.start();

      // Emit context_compacted for dev
      mocks.agentManager.emit('agent:context_compacted', { agentId: 'd1' });

      // refreshOne is synchronous — dev gets update immediately
      expect(dev.injectContextUpdate).toHaveBeenCalledTimes(1);
      // Secretary is NOT refreshed (only the compacted agent is)
      expect(secretary.injectContextUpdate).not.toHaveBeenCalled();
    });

    it('agent:spawned debounce deduplicates rapid events', () => {
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

      // Fire 3 rapid agent:spawned events
      mocks.agentManager.emit('agent:spawned', { id: 'a1' });
      mocks.agentManager.emit('agent:spawned', { id: 'a2' });
      mocks.agentManager.emit('agent:spawned', { id: 'a3' });

      // After debounce — only 1 refreshAll (debounced, not 3)
      vi.advanceTimersByTime(2000);
      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('lock activity routing', () => {
    it('secretary receives RECENT LOCK DENIALS section (only lock_denied, not acquire/release)', () => {
      const secretary = makeAgent({
        id: 's1',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary', receivesStatusUpdates: true },
      });
      const subLead = makeAgent({
        id: 'sublead-1',
        status: 'running',
        parentId: 'lead-1',
        role: { id: 'lead', name: 'Sub Lead' },
      });
      mocks.agentManager.getAll.mockReturnValue([secretary, subLead]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([
        {
          id: 1,
          agentId: 'dev-123456',
          agentRole: 'developer',
          actionType: 'lock_acquired',
          summary: 'Locked src/index.ts',
          timestamp: '2026-01-01T00:00:00Z',
          details: {},
          projectId: '',
        },
        {
          id: 2,
          agentId: 'dev-789012',
          agentRole: 'developer',
          actionType: 'lock_denied',
          summary: 'Denied access to src/index.ts',
          timestamp: '2026-01-01T00:01:00Z',
          details: {},
          projectId: '',
        },
        {
          id: 3,
          agentId: 'dev-123456',
          agentRole: 'developer',
          actionType: 'lock_released',
          summary: 'Released src/index.ts',
          timestamp: '2026-01-01T00:02:00Z',
          details: {},
          projectId: '',
        },
      ]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      expect(secretary.injectContextUpdate).toHaveBeenCalledTimes(1);
      const healthHeader = secretary.injectContextUpdate.mock.calls[0][2] as string;
      expect(healthHeader).toContain('RECENT LOCK DENIALS');
      expect(healthHeader).toContain('lock_denied');
      // lock_acquired and lock_released should NOT appear in the lock denials section
      expect(healthHeader).not.toContain('lock_acquired');
      expect(healthHeader).not.toContain('lock_released');
    });

    it('lead does NOT receive lock denials section', () => {
      const lead = makeAgent({
        id: 'lead-1',
        status: 'running',
        role: { id: 'lead', name: 'Project Lead', receivesStatusUpdates: true },
      });
      const subLead = makeAgent({
        id: 'sublead-1',
        status: 'running',
        parentId: 'lead-1',
        role: { id: 'lead', name: 'Sub Lead' },
      });
      mocks.agentManager.getAll.mockReturnValue([lead, subLead]);
      mocks.lockRegistry.getAll.mockReturnValue([]);
      mocks.activityLedger.getRecent.mockReturnValue([
        {
          id: 1,
          agentId: 'dev-123456',
          agentRole: 'developer',
          actionType: 'lock_denied',
          summary: 'Denied access to src/index.ts',
          timestamp: '2026-01-01T00:00:00Z',
          details: {},
          projectId: '',
        },
      ]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      expect(lead.injectContextUpdate).toHaveBeenCalledTimes(1);
      const healthHeader = lead.injectContextUpdate.mock.calls[0][2] as string;
      expect(healthHeader).not.toContain('RECENT LOCK DENIALS');
    });
  });

  describe('project isolation', () => {
    it('buildPeerList with projectId only returns agents from that project', () => {
      const projAAgent = makeAgent({ id: 'a1', role: { id: 'dev', name: 'Dev' }, status: 'running', task: 'task-a' });
      const projBAgent = makeAgent({ id: 'b1', role: { id: 'dev', name: 'Dev' }, status: 'running', task: 'task-b' });

      mocks.agentManager.getAll.mockReturnValue([projAAgent, projBAgent]);
      mocks.agentManager.getByProject.mockImplementation((pid: string) => {
        if (pid === 'proj-a') return [projAAgent];
        if (pid === 'proj-b') return [projBAgent];
        return [];
      });
      mocks.lockRegistry.getAll.mockReturnValue([]);

      const peersA = refresher.buildPeerList('proj-a');
      expect(peersA).toHaveLength(1);
      expect(peersA[0].id).toBe('a1');

      const peersB = refresher.buildPeerList('proj-b');
      expect(peersB).toHaveLength(1);
      expect(peersB[0].id).toBe('b1');

      // Without projectId, returns all
      const peersAll = refresher.buildPeerList();
      expect(peersAll).toHaveLength(2);
    });

    it('refreshAll only shows same-project peers to each agent', () => {
      const projALead = makeAgent({
        id: 'lead-a',
        status: 'running',
        role: { id: 'lead', name: 'Lead A', receivesStatusUpdates: true },
        task: 'proj-a task',
      });
      const projADev = makeAgent({
        id: 'dev-a',
        status: 'running',
        role: { id: 'dev', name: 'Dev A' },
        parentId: 'lead-a',
        task: 'dev-a task',
      });
      const projBLead = makeAgent({
        id: 'lead-b',
        status: 'running',
        role: { id: 'lead', name: 'Lead B', receivesStatusUpdates: true },
        task: 'proj-b task',
      });
      const projBDev = makeAgent({
        id: 'dev-b',
        status: 'running',
        role: { id: 'dev', name: 'Dev B' },
        parentId: 'lead-b',
        task: 'dev-b task',
      });

      mocks.agentManager.getAll.mockReturnValue([projALead, projADev, projBLead, projBDev]);
      mocks.agentManager.getProjectIdForAgent.mockImplementation((id: string) => {
        if (id === 'lead-a' || id === 'dev-a') return 'proj-a';
        if (id === 'lead-b' || id === 'dev-b') return 'proj-b';
        return undefined;
      });
      mocks.agentManager.getByProject.mockImplementation((pid: string) => {
        if (pid === 'proj-a') return [projALead, projADev];
        if (pid === 'proj-b') return [projBLead, projBDev];
        return [];
      });
      mocks.lockRegistry.getAll.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      // Lead A should only get peers from project A (dev-a), NOT lead-b or dev-b
      expect(projALead.injectContextUpdate).toHaveBeenCalledTimes(1);
      const peersA = projALead.injectContextUpdate.mock.calls[0][0];
      expect(peersA.map((p: any) => p.id)).toEqual(['dev-a']);
      expect(peersA.map((p: any) => p.id)).not.toContain('lead-b');
      expect(peersA.map((p: any) => p.id)).not.toContain('dev-b');

      // Lead B should only get peers from project B (dev-b), NOT lead-a or dev-a
      expect(projBLead.injectContextUpdate).toHaveBeenCalledTimes(1);
      const peersB = projBLead.injectContextUpdate.mock.calls[0][0];
      expect(peersB.map((p: any) => p.id)).toEqual(['dev-b']);
      expect(peersB.map((p: any) => p.id)).not.toContain('lead-a');
      expect(peersB.map((p: any) => p.id)).not.toContain('dev-a');
    });

    it('terminated agents from other projects do not appear in CREW_UPDATE', () => {
      const projASecretary = makeAgent({
        id: 'sec-a',
        status: 'running',
        role: { id: 'secretary', name: 'Secretary A', receivesStatusUpdates: true },
        task: 'monitoring',
      });
      const projBTerminated = makeAgent({
        id: 'dev-b',
        status: 'terminated',
        role: { id: 'dev', name: 'Dev B' },
        task: 'terminated task',
      });

      mocks.agentManager.getAll.mockReturnValue([projASecretary, projBTerminated]);
      mocks.agentManager.getProjectIdForAgent.mockImplementation((id: string) => {
        if (id === 'sec-a') return 'proj-a';
        if (id === 'dev-b') return 'proj-b';
        return undefined;
      });
      mocks.agentManager.getByProject.mockImplementation((pid: string) => {
        if (pid === 'proj-a') return [projASecretary];
        if (pid === 'proj-b') return [projBTerminated];
        return [];
      });
      mocks.lockRegistry.getAll.mockReturnValue([]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      expect(projASecretary.injectContextUpdate).toHaveBeenCalledTimes(1);
      const peers = projASecretary.injectContextUpdate.mock.calls[0][0];
      // The terminated agent from project B should NOT be visible
      expect(peers.map((p: any) => p.id)).not.toContain('dev-b');
    });

    it('file locks from other projects are not shown in CREW_UPDATE', () => {
      const projALead = makeAgent({
        id: 'lead-a',
        status: 'running',
        role: { id: 'lead', name: 'Lead A', receivesStatusUpdates: true },
      });

      mocks.agentManager.getAll.mockReturnValue([projALead]);
      mocks.agentManager.getProjectIdForAgent.mockImplementation((id: string) => {
        if (id === 'lead-a') return 'proj-a';
        if (id === 'dev-b') return 'proj-b';
        return undefined;
      });
      mocks.agentManager.getByProject.mockImplementation((pid: string) => {
        if (pid === 'proj-a') return [projALead];
        return [];
      });
      mocks.agentManager.get.mockImplementation((id: string) => {
        if (id === 'lead-a') return projALead;
        return { role: { name: 'Dev B' } };
      });
      mocks.lockRegistry.getAll.mockReturnValue([
        makeLock('lead-a', 'src/index.ts'),
        makeLock('dev-b', 'src/other.ts'),
      ]);
      (mocks.agentManager as any).getDecisionLog = vi.fn().mockReturnValue({
        getAll: vi.fn().mockReturnValue([]),
        getByLeadId: vi.fn().mockReturnValue([]),
      });
      (mocks.agentManager as any).getTaskDAG = vi.fn().mockReturnValue({
        getStatus: vi.fn().mockReturnValue({ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }),
      });

      refresher.refreshAll();

      expect(projALead.injectContextUpdate).toHaveBeenCalledTimes(1);
      const healthHeader = projALead.injectContextUpdate.mock.calls[0][2] as string;
      // Lead A should see their own lock but NOT dev-b's lock
      expect(healthHeader).toContain('src/index.ts');
      expect(healthHeader).not.toContain('src/other.ts');
    });

    it('buildRecentActivity passes projectId to activity ledger', () => {
      mocks.activityLedger.getRecent.mockReturnValue([]);

      refresher.buildRecentActivity(20, 'proj-a');

      expect(mocks.activityLedger.getRecent).toHaveBeenCalledWith(100, 'proj-a');
    });
  });
});
