import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/**
 * Tests for the idle-nudge timer logic in AgentManager.
 *
 * The idle nudge fires after 30s of continuous idle when the agent has
 * uncompleted DAG tasks. We simulate the timer and status transitions
 * that AgentManager's registerAgent() status listener orchestrates.
 */

// ── Minimal types matching AgentManager's idle nudge logic ───────────

interface MockAgent {
  id: string;
  parentId: string | undefined;
  status: string;
  isResuming: boolean;
  sendMessage: Mock;
}

interface MockTaskDAG {
  getTaskByAgent: Mock;
}

// ── Idle nudge logic extracted to match AgentManager behavior ────────

function isTerminalStatus(status: string): boolean {
  return status === 'terminated' || status === 'failed' || status === 'completed';
}

class IdleNudgeTracker {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private agents = new Map<string, MockAgent>();
  private taskDAG: MockTaskDAG;

  constructor(taskDAG: MockTaskDAG) {
    this.taskDAG = taskDAG;
  }

  registerAgent(agent: MockAgent): void {
    this.agents.set(agent.id, agent);
  }

  removeAgent(id: string): void {
    this.clearTimer(id);
    this.agents.delete(id);
  }

  /** Simulates status change — mirrors AgentManager's onStatus handler */
  onStatusChange(agent: MockAgent, status: string): void {
    agent.status = status;

    if (status === 'running') {
      this.clearTimer(agent.id);
    }

    if (status === 'idle' && agent.parentId && !agent.isResuming) {
      if (!this.timers.has(agent.id)) {
        const timer = setTimeout(() => {
          this.timers.delete(agent.id);
          if (agent.status !== 'idle' || isTerminalStatus(agent.status)) return;
          if (!this.agents.has(agent.id)) return;
          const leadId = agent.parentId;
          if (!leadId) return;
          const dagTask = this.taskDAG.getTaskByAgent(leadId, agent.id);
          if (dagTask && dagTask.dagStatus === 'running') {
            agent.sendMessage(
              `[System] You have an uncompleted task: "${dagTask.title || dagTask.id}". ` +
              `Please mark it done with COMPLETE_TASK, report PROGRESS, or explain what is blocking you.`
            );
          }
        }, 30_000);
        this.timers.set(agent.id, timer);
      }
    }
  }

  clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  clearAll(): void {
    for (const [_id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  hasTimer(id: string): boolean {
    return this.timers.has(id);
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Idle nudge timer', () => {
  let tracker: IdleNudgeTracker;
  let agent: MockAgent;
  let taskDAG: MockTaskDAG;

  beforeEach(() => {
    vi.useFakeTimers();
    taskDAG = {
      getTaskByAgent: vi.fn().mockReturnValue({
        id: 'task-1',
        title: 'Implement feature',
        dagStatus: 'running',
      }),
    };
    tracker = new IdleNudgeTracker(taskDAG);
    agent = {
      id: 'agent-dev-001',
      parentId: 'agent-lead-001',
      status: 'running',
      isResuming: false,
      sendMessage: vi.fn(),
    };
    tracker.registerAgent(agent);
  });

  afterEach(() => {
    tracker.clearAll();
    vi.useRealTimers();
  });

  it('sends nudge after 30s idle with uncompleted task', () => {
    tracker.onStatusChange(agent, 'idle');
    expect(agent.sendMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);

    expect(agent.sendMessage).toHaveBeenCalledTimes(1);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('You have an uncompleted task')
    );
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMPLETE_TASK')
    );
  });

  it('does NOT send nudge if agent resumes before 30s', () => {
    tracker.onStatusChange(agent, 'idle');
    vi.advanceTimersByTime(15_000); // 15s — halfway

    tracker.onStatusChange(agent, 'running'); // resumes work
    vi.advanceTimersByTime(20_000); // past the 30s mark

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT send nudge if no uncompleted tasks', () => {
    taskDAG.getTaskByAgent.mockReturnValue(null);

    tracker.onStatusChange(agent, 'idle');
    vi.advanceTimersByTime(30_000);

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('clears timer on agent removal (terminate)', () => {
    tracker.onStatusChange(agent, 'idle');
    expect(tracker.hasTimer(agent.id)).toBe(true);

    tracker.removeAgent(agent.id);
    expect(tracker.hasTimer(agent.id)).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('sends only ONE nudge per idle period (no spam)', () => {
    // First idle
    tracker.onStatusChange(agent, 'idle');
    // Trigger idle again without going running in between
    tracker.onStatusChange(agent, 'idle');

    vi.advanceTimersByTime(30_000);

    expect(agent.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('sends a new nudge after running→idle cycle', () => {
    // First idle cycle
    tracker.onStatusChange(agent, 'idle');
    vi.advanceTimersByTime(30_000);
    expect(agent.sendMessage).toHaveBeenCalledTimes(1);

    // Resume, then go idle again
    tracker.onStatusChange(agent, 'running');
    tracker.onStatusChange(agent, 'idle');
    vi.advanceTimersByTime(30_000);

    expect(agent.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does NOT send nudge if task is completed (not running)', () => {
    taskDAG.getTaskByAgent.mockReturnValue({
      id: 'task-1',
      title: 'Done task',
      dagStatus: 'done',
    });

    tracker.onStatusChange(agent, 'idle');
    vi.advanceTimersByTime(30_000);

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT send nudge for agents without a parent', () => {
    agent.parentId = undefined;

    tracker.onStatusChange(agent, 'idle');
    vi.advanceTimersByTime(30_000);

    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(tracker.hasTimer(agent.id)).toBe(false);
  });
});
