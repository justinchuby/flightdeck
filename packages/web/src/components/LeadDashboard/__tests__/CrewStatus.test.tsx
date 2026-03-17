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
  agentStatusText: (status: string) => {
    if (status === 'running') return 'text-green-400';
    if (status === 'completed') return 'text-blue-400';
    if (status === 'failed') return 'text-red-400';
    if (status === 'terminated') return 'text-orange-400';
    return 'text-gray-400';
  },
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
    expect(screen.getByText('No crew members yet')).toBeTruthy();
  });

  it('shows agent count as 0 in header for empty list', () => {
    render(<CrewStatus agents={[]} delegations={[]} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('renders agent cards with role icon, name, and short ID', () => {
    const agents = [
      makeAgent({ id: 'agent-1', role: { id: 'dev', name: 'Developer', icon: '💻', instructions: '' } }),
      makeAgent({ id: 'agent-2', role: { id: 'test', name: 'Tester', icon: '🧪', instructions: '' } }),
    ];
    render(<CrewStatus agents={agents} delegations={[]} />);
    expect(screen.getByText('💻')).toBeTruthy();
    expect(screen.getByText('🧪')).toBeTruthy();
    expect(screen.getByText(/Developer/)).toBeTruthy();
    expect(screen.getByText(/Tester/)).toBeTruthy();
  });

  it('shows agent count in header', () => {
    const agents = [makeAgent({ id: 'agent-1' }), makeAgent({ id: 'agent-2' }), makeAgent({ id: 'agent-3' })];
    render(<CrewStatus agents={agents} delegations={[]} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders "Crew" header label', () => {
    render(<CrewStatus agents={[]} delegations={[]} />);
    expect(screen.getByText('Crew')).toBeTruthy();
  });

  describe('agent statuses', () => {
    it.each(['running', 'completed', 'failed', 'terminated'] as const)(
      'renders %s status text',
      (status) => {
        const agents = [makeAgent({ id: 'a1', status })];
        render(<CrewStatus agents={agents} delegations={[]} />);
        expect(screen.getByText(status)).toBeTruthy();
      },
    );

    it('renders unknown status and falls back to Bot icon', () => {
      const agents = [makeAgent({ id: 'a1', status: 'idle' as AgentInfo['status'] })];
      render(<CrewStatus agents={agents} delegations={[]} />);
      expect(screen.getByText('idle')).toBeTruthy();
    });

    it('applies animate-spin class only to running status icon', () => {
      const agents = [
        makeAgent({ id: 'a1', status: 'running' }),
        makeAgent({ id: 'a2', status: 'completed' }),
      ];
      const { container } = render(<CrewStatus agents={agents} delegations={[]} />);
      const spinElements = container.querySelectorAll('.animate-spin');
      expect(spinElements.length).toBe(1);
    });
  });

  describe('delegations', () => {
    it('shows delegation task text', () => {
      const agents = [makeAgent({ id: 'agent-1' })];
      const delegations = [makeDelegation({ id: 'd1', toAgentId: 'agent-1', task: 'Build login page' })];
      render(<CrewStatus agents={agents} delegations={delegations} />);
      expect(screen.getByText('Build login page')).toBeTruthy();
    });

    it('uses the last matching delegation (reversed)', () => {
      const agents = [makeAgent({ id: 'agent-1' })];
      const delegations = [
        makeDelegation({ id: 'd1', toAgentId: 'agent-1', task: 'Old task' }),
        makeDelegation({ id: 'd2', toAgentId: 'agent-1', task: 'Latest task' }),
      ];
      render(<CrewStatus agents={agents} delegations={delegations} />);
      expect(screen.getByText('Latest task')).toBeTruthy();
      expect(screen.queryByText('Old task')).toBeNull();
    });

    it('does not show delegation text when none match', () => {
      const agents = [makeAgent({ id: 'agent-1' })];
      const delegations = [makeDelegation({ id: 'd1', toAgentId: 'other-agent', task: 'Wrong task' })];
      render(<CrewStatus agents={agents} delegations={delegations} />);
      expect(screen.queryByText('Wrong task')).toBeNull();
    });
  });

  describe('shortModel display', () => {
    it.each([
      ['claude-opus-4.5', 'Opus 4.5'],
      ['claude-sonnet-4.6', 'Sonnet 4.6'],
      ['claude-haiku-4.5', 'Haiku 4.5'],
      ['gemini-2.0-flash', 'Gemini 2.0 flash'],
      ['gpt-4o', 'GPT-4o'],
      ['gpt-4.1-codex', 'GPT-4.1 Codex'],
      ['some-custom-model', 'some-custom-model'],
    ])('displays model "%s" as "%s"', (model, expected) => {
      const agents = [makeAgent({ id: 'a1', model })];
      render(<CrewStatus agents={agents} delegations={[]} />);
      const badge = screen.getByTitle(model);
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe(expected);
    });

    it('does not render model badge when model is undefined', () => {
      const agents = [makeAgent({ id: 'a1', model: undefined })];
      render(<CrewStatus agents={agents} delegations={[]} />);
      // No element with a title attribute matching a model
      const modelBadges = screen.queryAllByTitle(/.+/);
      const modelSpan = modelBadges.find(el => el.classList.contains('text-\\[10px\\]'));
      expect(modelSpan).toBeUndefined();
    });
  });

  describe('provider badge', () => {
    it('renders ProviderBadge with provider value', () => {
      const agents = [makeAgent({ id: 'a1', provider: 'anthropic' })];
      render(<CrewStatus agents={agents} delegations={[]} />);
      expect(screen.getByTestId('provider-badge')).toBeTruthy();
      expect(screen.getByText('anthropic')).toBeTruthy();
    });
  });

  it('renders AgentIdBadge for each agent', () => {
    const agents = [makeAgent({ id: 'agent-1' }), makeAgent({ id: 'agent-2' })];
    render(<CrewStatus agents={agents} delegations={[]} />);
    const badges = screen.getAllByTestId('agent-badge');
    expect(badges.length).toBe(2);
  });
});
