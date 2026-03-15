// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CrewStatus } from '../CrewStatus';
import type { AgentInfo, Delegation } from '../../../types';

vi.mock('../../../utils/markdown', () => ({
  AgentIdBadge: ({ id }: { id: string }) => <span data-testid="agent-badge">{id.slice(0, 8)}</span>,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/statusColors', () => ({
  agentStatusText: () => 'text-green-400',
}));

vi.mock('../../ProviderBadge', () => ({
  ProviderBadge: ({ provider }: { provider?: string }) =>
    provider ? <span data-testid="provider-badge">{provider}</span> : null,
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function makeAgent(overrides: Partial<AgentInfo> & { id: string }): AgentInfo {
  return {
    role: { id: 'dev', name: 'Developer', icon: '💻', instructions: '' },
    status: 'running',
    childIds: [],
    createdAt: '2024-01-01',
    outputPreview: '',
    model: 'claude-sonnet-4',
    ...overrides,
  } as AgentInfo;
}

function makeDelegation(overrides: Partial<Delegation> & { id: string; toAgentId: string }): Delegation {
  return {
    fromAgentId: 'lead-1',
    toRole: 'developer',
    task: 'Implement feature',
    status: 'active',
    createdAt: '2024-01-01',
    ...overrides,
  } as Delegation;
}

describe('CrewStatus', () => {
  it('shows "No crew members yet" when empty', () => {
    render(<CrewStatus agents={[]} delegations={[]} />);
    expect(screen.getByText('No crew members yet')).toBeInTheDocument();
  });

  it('renders agent cards', () => {
    const agents = [
      makeAgent({ id: 'agent-1', role: { id: 'dev', name: 'Developer', icon: '💻', instructions: '' } }),
      makeAgent({ id: 'agent-2', role: { id: 'test', name: 'Tester', icon: '🧪', instructions: '' } }),
    ];
    render(<CrewStatus agents={agents} delegations={[]} />);
    expect(screen.getByText(/Developer/)).toBeInTheDocument();
    expect(screen.getByText(/Tester/)).toBeInTheDocument();
  });

  it('shows role icon and name', () => {
    const agents = [makeAgent({ id: 'agent-1' })];
    render(<CrewStatus agents={agents} delegations={[]} />);
    expect(screen.getByText('💻')).toBeInTheDocument();
    expect(screen.getByText(/Developer/)).toBeInTheDocument();
  });

  it('shows delegation task', () => {
    const agents = [makeAgent({ id: 'agent-1' })];
    const delegations = [makeDelegation({ id: 'd1', toAgentId: 'agent-1', task: 'Build login page' })];
    render(<CrewStatus agents={agents} delegations={delegations} />);
    expect(screen.getByText('Build login page')).toBeInTheDocument();
  });

  it('shows agent count in header', () => {
    const agents = [makeAgent({ id: 'agent-1' }), makeAgent({ id: 'agent-2' })];
    render(<CrewStatus agents={agents} delegations={[]} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders status text', () => {
    const agents = [makeAgent({ id: 'agent-1', status: 'running' })];
    render(<CrewStatus agents={agents} delegations={[]} />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });
});
