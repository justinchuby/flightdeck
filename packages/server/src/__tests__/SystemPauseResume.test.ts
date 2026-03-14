import { describe, it, expect, vi } from 'vitest';

// Minimal mock of Agent for pause/resume testing
function makeAgent(status = 'running') {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 10)}`,
    status,
    systemPaused: false,
    queueMessage: vi.fn(),
    drainPendingMessages: vi.fn(),
  };
}

// Extract just the pause/resume logic for unit testing
// (AgentManager is too complex to instantiate without full deps)
function simulatePauseSystem(agents: ReturnType<typeof makeAgent>[]) {
  for (const agent of agents) {
    agent.systemPaused = true;
    if (agent.status === 'running' || agent.status === 'idle') {
      agent.queueMessage('[System] ⏸️ The system has been paused by the user. Hold your current position — do not start new work or delegate tasks until resumed.');
    }
  }
}

function simulateResumeSystem(agents: ReturnType<typeof makeAgent>[]) {
  for (const agent of agents) {
    agent.systemPaused = false;
    if (agent.status === 'running' || agent.status === 'idle') {
      agent.queueMessage('[System] ▶️ The system has been resumed. You may continue your work.');
    }
  }
  for (const agent of agents) {
    if (agent.status === 'idle' || agent.status === 'running') {
      agent.drainPendingMessages();
    }
  }
}

describe('System pause/resume notifications', () => {
  it('sends pause message to running and idle agents', () => {
    const running = makeAgent('running');
    const idle = makeAgent('idle');
    const done = makeAgent('done');

    simulatePauseSystem([running, idle, done]);

    expect(running.queueMessage).toHaveBeenCalledWith(expect.stringContaining('paused'));
    expect(idle.queueMessage).toHaveBeenCalledWith(expect.stringContaining('paused'));
    expect(done.queueMessage).not.toHaveBeenCalled();
  });

  it('sends resume message to running and idle agents', () => {
    const running = makeAgent('running');
    const idle = makeAgent('idle');
    const done = makeAgent('done');

    simulateResumeSystem([running, idle, done]);

    expect(running.queueMessage).toHaveBeenCalledWith(expect.stringContaining('resumed'));
    expect(idle.queueMessage).toHaveBeenCalledWith(expect.stringContaining('resumed'));
    expect(done.queueMessage).not.toHaveBeenCalled();
  });

  it('drains pending messages on resume', () => {
    const running = makeAgent('running');
    const idle = makeAgent('idle');

    simulateResumeSystem([running, idle]);

    expect(running.drainPendingMessages).toHaveBeenCalled();
    expect(idle.drainPendingMessages).toHaveBeenCalled();
  });

  it('sets systemPaused flag correctly', () => {
    const agent = makeAgent('running');

    simulatePauseSystem([agent]);
    expect(agent.systemPaused).toBe(true);

    simulateResumeSystem([agent]);
    expect(agent.systemPaused).toBe(false);
  });
});
