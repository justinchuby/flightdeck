import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../stores/appStore';
import { PulseStrip } from '../Pulse/PulseStrip';
import type { AgentInfo, Role } from '../../types';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Writes code',
    systemPrompt: '',
    color: '#3B82F6',
    icon: '💻',
    builtIn: true,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 10)}`,
    role: makeRole(),
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    autopilot: true,
    ...overrides,
  };
}

function setAgents(agents: AgentInfo[]) {
  useAppStore.getState().setAgents(agents);
}

beforeEach(() => {
  useAppStore.getState().setAgents([]);
  useAppStore.getState().setPendingDecisions([]);
  useAppStore.getState().setApprovalQueueOpen(false);
});

describe('PulseStrip', () => {
  it('renders nothing when no agents exist', () => {
    const { container } = render(<PulseStrip />);
    expect(container.firstChild).toBeNull();
  });

  it('shows session cost and token count when agents exist', () => {
    setAgents([
      makeAgent({ inputTokens: 50_000, outputTokens: 10_000, status: 'running' }),
      makeAgent({ inputTokens: 30_000, outputTokens: 5_000, status: 'idle' }),
    ]);
    render(<PulseStrip />);
    // Cost: (80k * 0.000003) + (15k * 0.000015) = 0.24 + 0.225 = $0.47
    expect(screen.getByText('$0.47')).toBeDefined();
    // Token count
    expect(screen.getByText('(95k)')).toBeDefined();
  });

  it('shows pending decisions count from appStore', () => {
    setAgents([
      makeAgent({ status: 'running' }),
      makeAgent({ status: 'running' }),
    ]);
    useAppStore.getState().setPendingDecisions([
      {
        id: 'dec-1',
        agentId: 'agent-1',
        agentRole: 'Developer',
        title: 'Use prettier',
        rationale: '',
        needsConfirmation: true,
        status: 'recorded' as const,
        timestamp: new Date().toISOString(),
      },
    ]);
    render(<PulseStrip />);
    // 1 pending decision from appStore + 0 permission requests
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('pending')).toBeDefined();
  });

  it('shows zero pending when no decisions are waiting', () => {
    setAgents([makeAgent({ status: 'running' })]);
    render(<PulseStrip />);
    expect(screen.getByText('0')).toBeDefined();
  });

  it('shows status breakdown with running and idle counts', () => {
    setAgents([
      makeAgent({ status: 'running' }),
      makeAgent({ status: 'running' }),
      makeAgent({ status: 'running' }),
      makeAgent({ status: 'idle' }),
      makeAgent({ status: 'idle' }),
      makeAgent({ status: 'failed' }),
    ]);
    render(<PulseStrip />);
    // Running count (3 running agents)
    expect(screen.getByText('3')).toBeDefined();
    // Idle count (2 idle agents)
    expect(screen.getByText('2')).toBeDefined();
  });

  it('renders token pressure bars for agents with context data', () => {
    setAgents([
      makeAgent({
        status: 'running',
        contextWindowSize: 200_000,
        contextWindowUsed: 180_000,
      }),
      makeAgent({
        status: 'running',
        contextWindowSize: 200_000,
        contextWindowUsed: 40_000,
      }),
    ]);
    const { container } = render(<PulseStrip />);
    // Should have pressure bars (mini bar elements)
    const bars = container.querySelectorAll('[class*="rounded-full"][class*="bg-"]');
    expect(bars.length).toBeGreaterThan(0);
  });

  it('handles agents with no token data gracefully', () => {
    setAgents([makeAgent({ status: 'running' })]);
    const { container } = render(<PulseStrip />);
    expect(container.firstChild).not.toBeNull();
  });
});
