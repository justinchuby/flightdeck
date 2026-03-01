import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatMonitor } from '../agents/HeartbeatMonitor.js';
import type { HeartbeatContext, DagSummary } from '../agents/HeartbeatMonitor.js';
import type { Agent } from '../agents/Agent.js';
import type { Delegation } from '../agents/CommandDispatcher.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{
  id: string;
  role: { id: string; name: string };
  status: string;
  parentId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'agent-1',
    role: overrides.role ?? { id: 'dev', name: 'Developer' },
    status: overrides.status ?? 'idle',
    parentId: overrides.parentId ?? null,
    sendMessage: vi.fn(),
  } as unknown as Agent;
}

function makeDelegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    id: overrides.id ?? 'del-1',
    fromAgentId: overrides.fromAgentId ?? 'lead-1',
    toAgentId: overrides.toAgentId ?? 'agent-1',
    toRole: overrides.toRole ?? 'dev',
    task: overrides.task ?? 'implement feature',
    status: overrides.status ?? 'active',
  } as Delegation;
}

function makeDagSummary(overrides: Partial<DagSummary> = {}): DagSummary {
  return {
    pending: 0, ready: 0, running: 0, done: 0,
    failed: 0, blocked: 0, paused: 0, skipped: 0,
    ...overrides,
  };
}

function createMockContext(): HeartbeatContext & { getAllAgents: ReturnType<typeof vi.fn>; getDelegationsMap: ReturnType<typeof vi.fn>; getDagSummary: ReturnType<typeof vi.fn>; getTaskByAgent: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> } {
  return {
    getAllAgents: vi.fn().mockReturnValue([]),
    getDelegationsMap: vi.fn().mockReturnValue(new Map()),
    getDagSummary: vi.fn().mockReturnValue(null),
    getTaskByAgent: vi.fn().mockReturnValue(null),
    emit: vi.fn() as any,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('HeartbeatMonitor', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createMockContext();
    monitor = new HeartbeatMonitor(ctx);
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  /** Helper: set up a standard stalled-team scenario and trigger a check */
  function setupStalledTeam(overrides: {
    leadIdleMs?: number;
    childStatus?: string;
    delegations?: Delegation[];
    dagSummary?: DagSummary | null;
    children?: Agent[];
  } = {}) {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({
      id: 'child-1',
      role: { id: 'dev', name: 'Developer' },
      status: overrides.childStatus ?? 'idle',
      parentId: 'lead-1',
    });

    const children = overrides.children ?? [child];
    ctx.getAllAgents.mockReturnValue([lead, ...children]);

    // Set up delegations map
    const delegations = overrides.delegations ?? [];
    const delMap = new Map<string, Delegation>();
    for (const d of delegations) {
      delMap.set(d.id, d);
    }
    ctx.getDelegationsMap.mockReturnValue(delMap);

    // Set up DAG summary
    ctx.getDagSummary.mockReturnValue(overrides.dagSummary ?? null);

    // Track idle with a specific timestamp
    const idleMs = overrides.leadIdleMs ?? 90_000;
    monitor.trackIdle('lead-1');
    // Move time forward so the idle duration is correct
    vi.advanceTimersByTime(idleMs);

    return { lead, child, children };
  }

  function triggerCheck(): void {
    monitor.start(100);
    vi.advanceTimersByTime(100);
  }

  // ── 1. No nudge when lead idle < 60s ──────────────────────────────

  it('does not nudge when lead has been idle for less than 60s', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map([['d1', makeDelegation({ fromAgentId: 'lead-1' })]]));

    monitor.trackIdle('lead-1');
    // Only 30s idle — below threshold
    vi.advanceTimersByTime(30_000);

    triggerCheck();

    expect(lead.sendMessage).not.toHaveBeenCalled();
  });

  // ── 2. No nudge when lead has no children ─────────────────────────

  it('does not nudge when lead has no children', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead]); // no children
    ctx.getDelegationsMap.mockReturnValue(new Map([['d1', makeDelegation({ fromAgentId: 'lead-1' })]]));

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).not.toHaveBeenCalled();
  });

  // ── 3. No nudge when a child is running ───────────────────────────

  it('does not nudge when a child agent is running', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'running' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map([['d1', makeDelegation({ fromAgentId: 'lead-1' })]]));

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).not.toHaveBeenCalled();
  });

  // ── 3b. No nudge when a child is in 'creating' status ─────────────

  it('does not nudge when a child agent is being created', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'creating' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map([['d1', makeDelegation({ fromAgentId: 'lead-1' })]]));

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).not.toHaveBeenCalled();
  });

  // ── 3c. No nudge when DAG has running tasks ───────────────────────

  it('does not nudge when DAG has running tasks', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map([['d1', makeDelegation({ fromAgentId: 'lead-1' })]]));
    ctx.getDagSummary.mockReturnValue(makeDagSummary({ running: 2, pending: 1 }));

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).not.toHaveBeenCalled();
  });

  // ── 4. No nudge when no active delegations and no DAG tasks ───────

  it('does not nudge when there are no active delegations and no DAG tasks remaining', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map()); // no delegations
    ctx.getDagSummary.mockReturnValue(makeDagSummary({ done: 5 })); // all tasks done

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).not.toHaveBeenCalled();
  });

  // ── 5. Nudges when active delegations exist ───────────────────────

  it('nudges when lead is idle with active delegations', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith('agent:message_sent', expect.objectContaining({
      from: 'system',
      to: 'lead-1',
    }));
  });

  // ── 6. Nudges when DAG tasks remain ───────────────────────────────

  it('nudges when DAG tasks remain (ready/pending)', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map()); // no delegations
    ctx.getDagSummary.mockReturnValue(makeDagSummary({ ready: 2, pending: 1 }));

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    expect(lead.sendMessage).toHaveBeenCalledTimes(1);
  });

  // ── 7. Nudge message includes DAG details ─────────────────────────

  it('includes DAG task details in the nudge message', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map());
    ctx.getDagSummary.mockReturnValue(makeDagSummary({ ready: 3, pending: 1, blocked: 2 }));

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('DAG tasks remaining');
    expect(message).toContain('3 ready');
    expect(message).toContain('1 pending');
    expect(message).toContain('2 blocked');
  });

  // ── 8. Nudge message includes delegation count ────────────────────

  it('includes active delegation count in the nudge message', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map([
      ['d1', makeDelegation({ id: 'd1', fromAgentId: 'lead-1', status: 'active' })],
      ['d2', makeDelegation({ id: 'd2', fromAgentId: 'lead-1', status: 'active' })],
    ]));
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('2 active delegations still pending');
  });

  // ── 9. Nudge count increments ─────────────────────────────────────

  it('increments nudge count on successive checks', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    // First check
    triggerCheck();
    expect(lead.sendMessage).toHaveBeenCalledTimes(1);

    // Second check (advance again to trigger another interval tick)
    vi.advanceTimersByTime(100);
    expect(lead.sendMessage).toHaveBeenCalledTimes(2);
  });

  // ── 10. Escalation after 2 nudges ─────────────────────────────────

  it('emits lead:stalled after 2 consecutive nudges', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    // First check — no escalation
    triggerCheck();
    expect(ctx.emit).not.toHaveBeenCalledWith('lead:stalled', expect.anything());

    // Second check — should escalate
    vi.advanceTimersByTime(100);
    expect(ctx.emit).toHaveBeenCalledWith('lead:stalled', expect.objectContaining({
      leadId: 'lead-1',
      nudgeCount: 2,
    }));
  });

  // ── 11. trackActive resets nudge count ────────────────────────────

  it('resets nudge count when trackActive is called', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    // Build up to 1 nudge
    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);
    triggerCheck();
    expect(lead.sendMessage).toHaveBeenCalledTimes(1);

    // Stop before advancing more time (otherwise the 100ms interval fires hundreds of times)
    monitor.stop();

    // Reset via trackActive
    monitor.trackActive('lead-1');
    ctx.emit.mockClear();

    // Go idle again
    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();
    // First nudge after reset — count is back to 1, so no escalation
    expect(ctx.emit).not.toHaveBeenCalledWith('lead:stalled', expect.anything());

    // Second nudge after reset — count is 2, should escalate
    vi.advanceTimersByTime(100);
    expect(ctx.emit).toHaveBeenCalledWith('lead:stalled', expect.objectContaining({
      leadId: 'lead-1',
      nudgeCount: 2,
    }));
  });

  // ── 12. start/stop manages timer ──────────────────────────────────

  it('start creates an interval and stop clears it', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    monitor.start(200);

    // Advance past one interval tick — should trigger check
    vi.advanceTimersByTime(200);
    expect(lead.sendMessage).toHaveBeenCalledTimes(1);

    // Stop — further ticks should not trigger
    monitor.stop();
    vi.advanceTimersByTime(200);
    expect(lead.sendMessage).toHaveBeenCalledTimes(1); // no additional call
  });

  it('calling start multiple times clears the previous interval', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    // Start twice — should not double-fire
    monitor.start(200);
    monitor.start(200);

    vi.advanceTimersByTime(200);
    // Only one check from the second interval (first was cleared)
    expect(lead.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('trackRemoved cleans up idle and nudge tracking for a lead', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1' });

    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(new Map([['d1', makeDelegation()]]));

    monitor.start(100);
    monitor.trackIdle('lead-1');

    // Need to advance past the 60s idle threshold for nudge to fire
    vi.advanceTimersByTime(61_000);
    expect(lead.sendMessage).toHaveBeenCalled();

    // Remove the lead
    monitor.trackRemoved('lead-1');

    (lead.sendMessage as any).mockClear();
    vi.advanceTimersByTime(61_000);
    // No more nudges after removal (idleSince was deleted)
    expect(lead.sendMessage).not.toHaveBeenCalled();
  });
});
