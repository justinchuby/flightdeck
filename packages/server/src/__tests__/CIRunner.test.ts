import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CIRunner } from '../coordination/CIRunner.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { TaskDAG } from '../tasks/TaskDAG.js';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, _opts: any, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    // Simulate successful commands by default
    setTimeout(() => cb(null, 'Build succeeded\nAll 1264 tests passed', ''), 10);
    return { on: vi.fn() };
  }),
}));

function makeMockAgent(id: string, role = 'developer', status = 'running') {
  return {
    id,
    role: { id: role, name: role },
    status,
    sendMessage: vi.fn(),
  };
}

function makeMockLedger(): ActivityLedger {
  return { log: vi.fn() } as any;
}

function makeMockDAG(): TaskDAG {
  return {
    getTasks: vi.fn().mockReturnValue([]),
    declareTaskBatch: vi.fn().mockReturnValue({ tasks: [], conflicts: [] }),
  } as any;
}

describe('CIRunner', () => {
  let ciRunner: CIRunner;
  let agents: ReturnType<typeof makeMockAgent>[];
  let ledger: ActivityLedger;
  let dag: TaskDAG;

  beforeEach(() => {
    vi.useFakeTimers();
    const leadAgent = makeMockAgent('lead-001', 'lead');
    const devAgent = makeMockAgent('dev-001', 'developer');
    agents = [leadAgent, devAgent];
    ledger = makeMockLedger();
    dag = makeMockDAG();

    ciRunner = new CIRunner({
      cwd: '/tmp/test-project',
      getAgent: (id) => agents.find(a => a.id === id) as any,
      getAllAgents: () => agents as any,
      activityLedger: ledger,
      taskDAG: dag,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a valid EventHandler', () => {
    const handler = ciRunner.createHandler();
    expect(handler.name).toBe('ci-runner');
    expect(handler.eventTypes).toContain('file_edit');
  });

  it('detects commit events via meta.shouldRunTests', () => {
    const handler = ciRunner.createHandler();
    const enqueueSpy = vi.spyOn(ciRunner, 'enqueue');

    handler.handle({
      entry: {
        id: 1, agentId: 'dev-001', agentRole: 'developer',
        actionType: 'file_edit', summary: 'some file edit',
        details: {}, timestamp: new Date().toISOString(),
      },
      meta: { shouldRunTests: true },
    });

    expect(enqueueSpy).toHaveBeenCalled();
  });

  it('detects commit events via details.type === commit', () => {
    const handler = ciRunner.createHandler();
    const enqueueSpy = vi.spyOn(ciRunner, 'enqueue');

    handler.handle({
      entry: {
        id: 2, agentId: 'dev-001', agentRole: 'developer',
        actionType: 'file_edit', summary: 'Commit: fix tests',
        details: { type: 'commit' }, timestamp: new Date().toISOString(),
      },
      meta: {},
    });

    expect(enqueueSpy).toHaveBeenCalled();
  });

  it('ignores non-commit file_edit events', () => {
    const handler = ciRunner.createHandler();
    const enqueueSpy = vi.spyOn(ciRunner, 'enqueue');

    handler.handle({
      entry: {
        id: 3, agentId: 'dev-001', agentRole: 'developer',
        actionType: 'file_edit', summary: 'edited config.ts',
        details: {}, timestamp: new Date().toISOString(),
      },
      meta: {},
    });

    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('debounces rapid commits', () => {
    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'commit 1' });
    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'commit 2' });

    // Before debounce timeout, not running
    expect(ciRunner.isRunning()).toBe(false);
  });

  it('runs CI after debounce and reports results', async () => {
    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'commit 1' });

    // Advance past debounce (5s)
    vi.advanceTimersByTime(6000);

    // Wait for async processing
    await vi.runAllTimersAsync();

    // The dev agent should receive CI results
    const devAgent = agents.find(a => a.id === 'dev-001')!;
    expect(devAgent.sendMessage).toHaveBeenCalled();
    const msg = devAgent.sendMessage.mock.calls[0][0];
    expect(msg).toContain('[CI');

    // Activity ledger should be logged
    expect((ledger.log as any)).toHaveBeenCalled();
  });

  it('notifies lead on CI completion', async () => {
    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'commit 1' });
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    const leadAgent = agents.find(a => a.id === 'lead-001')!;
    expect(leadAgent.sendMessage).toHaveBeenCalled();
  });

  it('emits ci:complete event', async () => {
    const completeSpy = vi.fn();
    ciRunner.on('ci:complete', completeSpy);

    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'commit 1' });
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('creates fix-build DAG task on failure', async () => {
    // Override exec to simulate failure
    const { exec } = await import('child_process');
    (exec as any).mockImplementation((cmd: string, _opts: any, cb: any) => {
      setTimeout(() => cb(new Error('Build failed'), '', 'error: TS2345'), 10);
      return { on: vi.fn() };
    });

    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'broken commit' });
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    expect((dag.declareTaskBatch as any)).toHaveBeenCalledWith(
      'lead-001',
      expect.arrayContaining([expect.objectContaining({ role: 'developer' })]),
    );
  });

  it('getLastResult returns null initially', () => {
    expect(ciRunner.getLastResult()).toBeNull();
  });

  it('getLastResult returns result after successful run', async () => {
    ciRunner.enqueue({ agentId: 'dev-001', agentRole: 'developer', summary: 'commit 1' });
    vi.advanceTimersByTime(6000);
    await vi.runAllTimersAsync();

    const result = ciRunner.getLastResult();
    expect(result).not.toBeNull();
    expect(result!.steps.length).toBeGreaterThan(0);
  });
});
