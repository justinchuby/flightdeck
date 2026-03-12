import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatMonitor, buildCommandReminderMessage } from '../agents/HeartbeatMonitor.js';
import type { HeartbeatContext, DagSummary } from '../agents/HeartbeatMonitor.js';
import type { Agent } from '../agents/Agent.js';
import type { Delegation } from '../agents/CommandDispatcher.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{
  id: string;
  role: { id: string; name: string };
  status: string;
  parentId: string | null;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'agent-1',
    role: overrides.role ?? { id: 'dev', name: 'Developer' },
    status: overrides.status ?? 'idle',
    parentId: overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    sendMessage: vi.fn(),
    queueMessage: vi.fn(),
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

function createMockContext(): HeartbeatContext & { getAllAgents: ReturnType<typeof vi.fn>; getDelegationsMap: ReturnType<typeof vi.fn>; getDagSummary: ReturnType<typeof vi.fn>; getTaskByAgent: ReturnType<typeof vi.fn>; getRemainingTasks: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> } {
  return {
    getAllAgents: vi.fn().mockReturnValue([]),
    getDelegationsMap: vi.fn().mockReturnValue(new Map()),
    getDagSummary: vi.fn().mockReturnValue(null),
    getTaskByAgent: vi.fn().mockReturnValue(null),
    getRemainingTasks: vi.fn().mockReturnValue([]),
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
    ctx.getRemainingTasks.mockReturnValue([
      { id: 'task-1', description: 'Implement feature A', dagStatus: 'ready' },
      { id: 'task-2', description: 'Fix bug B', dagStatus: 'ready' },
    ]);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
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

  // ── 10. Escalation after 5 nudges ─────────────────────────────────

  it('emits lead:stalled after 5 consecutive nudges', () => {
    const lead = makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Team Lead' }, status: 'idle' });
    const child = makeAgent({ id: 'child-1', parentId: 'lead-1', status: 'idle' });
    ctx.getAllAgents.mockReturnValue([lead, child]);
    ctx.getDelegationsMap.mockReturnValue(
      new Map([['d1', makeDelegation({ fromAgentId: 'lead-1', status: 'active' })]])
    );
    ctx.getDagSummary.mockReturnValue(null);

    monitor.trackIdle('lead-1');
    vi.advanceTimersByTime(90_000);

    // First 4 checks — no escalation
    triggerCheck();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(100);
    }
    expect(ctx.emit).not.toHaveBeenCalledWith('lead:stalled', expect.anything());

    // 5th check — should escalate
    vi.advanceTimersByTime(100);
    expect(ctx.emit).toHaveBeenCalledWith('lead:stalled', expect.objectContaining({
      leadId: 'lead-1',
      nudgeCount: 5,
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

    // Nudges 2-4 after reset — still no escalation (threshold is 5)
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    expect(ctx.emit).not.toHaveBeenCalledWith('lead:stalled', expect.anything());

    // 5th nudge after reset — should escalate
    vi.advanceTimersByTime(100);
    expect(ctx.emit).toHaveBeenCalledWith('lead:stalled', expect.objectContaining({
      leadId: 'lead-1',
      nudgeCount: 5,
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

  // ── New: nudge message format ───────────────────────────────────────

  it('uses soft "[System] Reminder:" prefix instead of "stalled"', () => {
    const { lead } = setupStalledTeam({
      delegations: [makeDelegation({ fromAgentId: 'lead-1', status: 'active' })],
    });

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('[System] Reminder:');
    expect(message).not.toContain('stalled');
    expect(message).not.toContain('[System Heartbeat]');
  });

  it('includes remaining tasks in nudge message', () => {
    ctx.getRemainingTasks.mockReturnValue([
      { id: 'qa-test', description: 'QA testing of isolation', dagStatus: 'ready' },
      { id: 'fix-alerts', description: 'Fix AlertEngine scoping', dagStatus: 'ready' },
      { id: 'update-docs', description: 'Update documentation', dagStatus: 'blocked' },
    ]);

    const { lead } = setupStalledTeam({
      dagSummary: makeDagSummary({ ready: 2, blocked: 1 }),
    });

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('qa-test: QA testing of isolation (ready)');
    expect(message).toContain('fix-alerts: Fix AlertEngine scoping (ready)');
    expect(message).toContain('update-docs: Update documentation (blocked)');
  });

  it('includes actionable hints in nudge', () => {
    const { lead } = setupStalledTeam({
      delegations: [makeDelegation({ fromAgentId: 'lead-1', status: 'active' })],
    });

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('DELEGATE');
    expect(message).toContain('QUERY_CREW');
    expect(message).toContain('HALT_HEARTBEAT');
  });

  it('truncates task list to 8 entries', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      id: `task-${i}`,
      description: `Task number ${i}`,
      dagStatus: 'ready',
    }));
    ctx.getRemainingTasks.mockReturnValue(tasks);

    const { lead } = setupStalledTeam({
      dagSummary: makeDagSummary({ ready: 12 }),
    });

    triggerCheck();

    const message = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toContain('task-7'); // 8th task (0-indexed)
    expect(message).not.toContain('task-8'); // 9th task should not appear
    expect(message).toContain('... and 4 more');
  });

  // ── Backoff logic ────────────────────────────────────────────────────

  describe('shouldSkipNudge backoff', () => {
    it('fires nudges 1-3 on every cycle', () => {
      expect(monitor.shouldSkipNudge(1)).toBe(false);
      expect(monitor.shouldSkipNudge(2)).toBe(false);
      expect(monitor.shouldSkipNudge(3)).toBe(false);
    });

    it('fires nudges 4-6 only on even cycles (every 2nd)', () => {
      expect(monitor.shouldSkipNudge(4)).toBe(false); // even → fire
      expect(monitor.shouldSkipNudge(5)).toBe(true);  // odd → skip
      expect(monitor.shouldSkipNudge(6)).toBe(false); // even → fire
    });

    it('fires nudges 7+ only every 3rd cycle', () => {
      expect(monitor.shouldSkipNudge(7)).toBe(true);  // 7%3=1 → skip
      expect(monitor.shouldSkipNudge(8)).toBe(true);  // 8%3=2 → skip
      expect(monitor.shouldSkipNudge(9)).toBe(false); // 9%3=0 → fire
      expect(monitor.shouldSkipNudge(10)).toBe(true); // 10%3=1 → skip
      expect(monitor.shouldSkipNudge(11)).toBe(true); // 11%3=2 → skip
      expect(monitor.shouldSkipNudge(12)).toBe(false); // 12%3=0 → fire
    });
  });

  it('skips nudge delivery on backoff cycles', () => {
    const delegation = makeDelegation({ fromAgentId: 'lead-1', status: 'active' });
    const { lead } = setupStalledTeam({
      delegations: [delegation],
      dagSummary: makeDagSummary({ ready: 1 }),
    });

    // Fire 5 consecutive check cycles — nudges 1-3 fire, 4 fires (even), 5 skips (odd)
    for (let i = 0; i < 5; i++) {
      triggerCheck();
      monitor.stop(); // stop interval before next cycle
    }

    // Nudges 1, 2, 3, 4 fire; nudge 5 is skipped → 4 messages total
    expect((lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });

  // ── Periodic command reminders ──────────────────────────────────────

  describe('periodic command reminders', () => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    it('sends command reminder to agent after 2 hours', () => {
      const agent = makeAgent({
        id: 'dev-1',
        role: { id: 'dev', name: 'Developer' },
        status: 'running',
        createdAt: new Date(Date.now()), // created "now" (fake-timer start)
      });
      ctx.getAllAgents.mockReturnValue([agent]);

      // Not yet 2 hours — no reminder
      vi.advanceTimersByTime(TWO_HOURS - 1000);
      triggerCheck();
      expect(agent.queueMessage).not.toHaveBeenCalled();

      monitor.stop();

      // Cross the 2-hour mark
      vi.advanceTimersByTime(2000);
      triggerCheck();
      expect(agent.queueMessage).toHaveBeenCalledTimes(1);
      expect(agent.queueMessage).toHaveBeenCalledWith(expect.stringContaining('Command Reference Reminder'));
    });

    it('uses queueMessage, not sendMessage, for reminders', () => {
      const agent = makeAgent({
        id: 'dev-1',
        role: { id: 'dev', name: 'Developer' },
        status: 'running',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      ctx.getAllAgents.mockReturnValue([agent]);

      triggerCheck();

      expect(agent.queueMessage).toHaveBeenCalledTimes(1);
      // sendMessage should NOT have been called for the reminder
      // (it may be called for lead nudges, but this agent is not a lead)
      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('does not remind agents younger than 2 hours', () => {
      const agent = makeAgent({
        id: 'dev-1',
        role: { id: 'dev', name: 'Developer' },
        status: 'running',
        createdAt: new Date(Date.now()), // just created
      });
      ctx.getAllAgents.mockReturnValue([agent]);

      vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour
      triggerCheck();

      expect(agent.queueMessage).not.toHaveBeenCalled();
    });

    it('sends reminders to ALL agents regardless of role', () => {
      const lead = makeAgent({
        id: 'lead-1',
        role: { id: 'lead', name: 'Team Lead' },
        status: 'idle',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      const dev = makeAgent({
        id: 'dev-1',
        role: { id: 'dev', name: 'Developer' },
        status: 'running',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      const reviewer = makeAgent({
        id: 'rev-1',
        role: { id: 'reviewer', name: 'Reviewer' },
        status: 'idle',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      ctx.getAllAgents.mockReturnValue([lead, dev, reviewer]);

      triggerCheck();

      expect(lead.queueMessage).toHaveBeenCalledTimes(1);
      expect(dev.queueMessage).toHaveBeenCalledTimes(1);
      expect(reviewer.queueMessage).toHaveBeenCalledTimes(1);
    });

    it('skips terminal agents (completed, failed, terminated)', () => {
      const terminated = makeAgent({
        id: 'term-1',
        status: 'terminated',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      const completed = makeAgent({
        id: 'done-1',
        status: 'completed',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      const running = makeAgent({
        id: 'run-1',
        status: 'running',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      ctx.getAllAgents.mockReturnValue([terminated, completed, running]);

      triggerCheck();

      expect(terminated.queueMessage).not.toHaveBeenCalled();
      expect(completed.queueMessage).not.toHaveBeenCalled();
      expect(running.queueMessage).toHaveBeenCalledTimes(1);
    });

    it('repeats reminder every 2 hours (not every check)', () => {
      const agent = makeAgent({
        id: 'dev-1',
        status: 'running',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      ctx.getAllAgents.mockReturnValue([agent]);

      // First check — should remind
      triggerCheck();
      expect(agent.queueMessage).toHaveBeenCalledTimes(1);
      monitor.stop();

      // Second check shortly after — should NOT remind again
      vi.advanceTimersByTime(1000);
      triggerCheck();
      expect(agent.queueMessage).toHaveBeenCalledTimes(1);
      monitor.stop();

      // After another 2 hours — should remind again
      vi.advanceTimersByTime(TWO_HOURS);
      triggerCheck();
      expect(agent.queueMessage).toHaveBeenCalledTimes(2);
    });

    it('resets reminder tracking when agent is removed', () => {
      const agent = makeAgent({
        id: 'dev-1',
        status: 'running',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      ctx.getAllAgents.mockReturnValue([agent]);

      // First reminder
      triggerCheck();
      expect(agent.queueMessage).toHaveBeenCalledTimes(1);
      monitor.stop();

      // Remove agent
      monitor.trackRemoved('dev-1');

      // Re-add same agent (simulating respawn) — should use createdAt again
      const respawned = makeAgent({
        id: 'dev-1',
        status: 'running',
        createdAt: new Date(Date.now()), // fresh creation time
      });
      ctx.getAllAgents.mockReturnValue([respawned]);

      triggerCheck();
      // Should NOT remind since fresh agent is <2h old
      expect(respawned.queueMessage).not.toHaveBeenCalled();
    });

    it('emits agent:message_sent event for reminders', () => {
      const agent = makeAgent({
        id: 'dev-1',
        role: { id: 'dev', name: 'Developer' },
        status: 'running',
        createdAt: new Date(Date.now() - TWO_HOURS - 1000),
      });
      ctx.getAllAgents.mockReturnValue([agent]);

      triggerCheck();

      expect(ctx.emit).toHaveBeenCalledWith('agent:message_sent', expect.objectContaining({
        from: 'system',
        fromRole: 'System',
        to: 'dev-1',
        toRole: 'Developer',
      }));
    });
  });

  // ── buildCommandReminderMessage ─────────────────────────────────────

  describe('buildCommandReminderMessage', () => {
    it('includes key commands', () => {
      const msg = buildCommandReminderMessage();
      expect(msg).toContain('COMMIT');
      expect(msg).toContain('LOCK_FILE');
      expect(msg).toContain('UNLOCK_FILE');
      expect(msg).toContain('COMPLETE_TASK');
      expect(msg).toContain('AGENT_MESSAGE');
      expect(msg).toContain('DIRECT_MESSAGE');
      expect(msg).toContain('GROUP_MESSAGE');
      expect(msg).toContain('PROGRESS');
      expect(msg).toContain('DECISION');
      expect(msg).toContain('SET_TIMER');
    });

    it('includes usage hint about text response', () => {
      const msg = buildCommandReminderMessage();
      expect(msg).toContain('directly in your text response');
    });
  });
});
