import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReplayContent } from '../ReplayContent';
import type { ReplayWorldState } from '../../../hooks/useSessionReplay';

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseWorldState: ReplayWorldState = {
  timestamp: '2026-03-20T12:00:00Z',
  agents: [
    { id: 'lead-uuid-1234', role: 'lead', status: 'running' },
    { id: 'dev-uuid-5678', role: 'developer', status: 'running', contextUsedPct: 45 },
    { id: 'rev-uuid-9012', role: 'code-reviewer', status: 'idle' },
  ],
  dagTasks: [
    { id: 'setup-auth', description: 'Set up authentication', dagStatus: 'done', assignedAgentId: 'dev-uuid-5678' },
    { id: 'build-api', description: 'Build REST API', dagStatus: 'running', role: 'developer' },
    { id: 'write-tests', dagStatus: 'pending' },
  ],
  decisions: [
    { id: 'dec-1', title: 'Use JWT for auth tokens', status: 'confirmed', agentRole: 'lead' },
    { id: 'dec-2', title: 'Add rate limiting?', status: 'pending', agentRole: 'developer' },
  ],
  recentActivity: [
    { id: 1, agentId: 'dev-uuid-5678', agentRole: 'developer', actionType: 'task_completed', summary: 'Auth module complete', timestamp: '2026-03-20T11:58:00Z' },
    { id: 2, agentId: 'lead-uuid-1234', agentRole: 'lead', actionType: 'progress_update', summary: 'Phase 1 done', timestamp: '2026-03-20T11:55:00Z' },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ReplayContent', () => {
  it('renders empty state when worldState is null', () => {
    render(<ReplayContent worldState={null} />);
    expect(screen.getByTestId('replay-content-empty')).toBeTruthy();
    expect(screen.getByText('Scrub the timeline to see session state')).toBeTruthy();
  });

  it('renders loading spinner', () => {
    render(<ReplayContent worldState={null} loading />);
    expect(screen.getByTestId('replay-content-loading')).toBeTruthy();
  });

  it('renders agent roster from world state', () => {
    render(<ReplayContent worldState={baseWorldState} />);
    const agents = screen.getAllByTestId('replay-agent');
    expect(agents).toHaveLength(3);
    expect(screen.getByText('lead')).toBeTruthy();
    expect(screen.getByText('developer')).toBeTruthy();
    expect(screen.getByText('code-reviewer')).toBeTruthy();
  });

  it('renders task DAG from world state', () => {
    render(<ReplayContent worldState={baseWorldState} />);
    const tasks = screen.getAllByTestId('replay-task');
    expect(tasks).toHaveLength(3);
    expect(screen.getByText('setup-auth')).toBeTruthy();
    expect(screen.getByText('build-api')).toBeTruthy();
    expect(screen.getByText('write-tests')).toBeTruthy();
  });

  it('renders decisions from world state', () => {
    render(<ReplayContent worldState={baseWorldState} />);
    const decisions = screen.getAllByTestId('replay-decision');
    expect(decisions).toHaveLength(2);
    expect(screen.getByText('Use JWT for auth tokens')).toBeTruthy();
    expect(screen.getByText('Add rate limiting?')).toBeTruthy();
  });

  it('renders activity feed from world state', () => {
    render(<ReplayContent worldState={baseWorldState} />);
    const activities = screen.getAllByTestId('replay-activity');
    expect(activities).toHaveLength(2);
    expect(screen.getByText('Auth module complete')).toBeTruthy();
    expect(screen.getByText('Phase 1 done')).toBeTruthy();
  });

  it('renders summary bar with counts derived from arrays', () => {
    render(<ReplayContent worldState={baseWorldState} />);
    expect(screen.getByText('3 agents (2 running)')).toBeTruthy();
    // 1 done out of 3 tasks (derived from dagTasks array)
    expect(screen.getByText('1/3 tasks')).toBeTruthy();
    // 1 pending decision (derived from decisions array)
    expect(screen.getByText('1 pending decisions')).toBeTruthy();
  });

  it('handles world state with no tasks or decisions', () => {
    const minimal: ReplayWorldState = {
      timestamp: '2026-03-20T12:00:00Z',
      agents: [{ id: 'a1', role: 'lead', status: 'running' }],
    };
    render(<ReplayContent worldState={minimal} />);
    expect(screen.getByTestId('replay-content')).toBeTruthy();
    expect(screen.getByText('No tasks or decisions at this point')).toBeTruthy();
  });
});
