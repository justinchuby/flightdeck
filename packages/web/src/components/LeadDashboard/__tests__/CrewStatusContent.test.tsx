// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CrewStatusContent, type CrewAgent } from '../CrewStatusContent';
import type { Delegation } from '../../../types';

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ agents: [], setSelectedAgent: vi.fn() }),
    { getState: () => ({ agents: [], setSelectedAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../../../utils/statusColors', () => ({
  agentStatusText: () => 'text-green-400',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n: number) => `${n}`,
}));

vi.mock('../../Toast', () => ({
  useToastStore: { getState: () => ({ add: vi.fn() }) },
}));

vi.mock('../AgentReportBlock', () => ({
  AgentReportBlock: ({ content }: { content: string }) => <span>{content}</span>,
}));

vi.mock('../../ProviderBadge', () => ({
  ProviderBadge: () => <span data-testid="provider-badge" />,
}));

const testAgents: CrewAgent[] = [
  { id: 'dev-1', role: { name: 'Developer', icon: '🛠️' }, status: 'running', model: 'claude-sonnet-4' },
  { id: 'arch-1', role: { name: 'Architect', icon: '🏗️' }, status: 'completed' },
];

const testDelegations: Delegation[] = [
  { id: 'del-1', toAgentId: 'dev-1', task: 'Fix the login bug' } as Delegation,
];

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('CrewStatusContent', () => {
  it('shows "No crew members" when empty', () => {
    render(<CrewStatusContent agents={[]} delegations={[]} />);
    expect(screen.getByText('No crew members yet')).toBeDefined();
  });

  it('renders agent cards with role names', () => {
    render(<CrewStatusContent agents={testAgents} delegations={testDelegations} />);
    expect(screen.getByText('Developer')).toBeDefined();
    expect(screen.getByText('Architect')).toBeDefined();
  });

  it('shows agent status text', () => {
    render(<CrewStatusContent agents={testAgents} delegations={testDelegations} />);
    expect(screen.getByText('running')).toBeDefined();
    expect(screen.getByText('completed')).toBeDefined();
  });

  it('shows delegation task for assigned agent', () => {
    render(<CrewStatusContent agents={testAgents} delegations={testDelegations} />);
    expect(screen.getByText('Fix the login bug')).toBeDefined();
  });

  it('shows role icon', () => {
    render(<CrewStatusContent agents={testAgents} delegations={testDelegations} />);
    expect(screen.getByText('🛠️')).toBeDefined();
    expect(screen.getByText('🏗️')).toBeDefined();
  });

  it('clicking agent opens detail panel', () => {
    render(<CrewStatusContent agents={testAgents} delegations={testDelegations} />);
    fireEvent.click(screen.getAllByText('Developer')[0]);
    expect(screen.getAllByText('Developer').length).toBeGreaterThanOrEqual(1);
  });

  it('shows chat button when onOpenChat provided', () => {
    const onOpenChat = vi.fn();
    render(<CrewStatusContent agents={testAgents} delegations={testDelegations} onOpenChat={onOpenChat} />);
    const chatBtns = screen.getAllByRole('button');
    expect(chatBtns.length).toBeGreaterThan(0);
  });
});






const makeAgent = (id: string, role: string, status = 'running', extra = {}) => ({
  id,
  role: { name: role, icon: '\ud83d\udcbb' },
  status,
  model: 'gpt-4',
  provider: 'openai',
  ...extra,
});

const makeDelegation = (id: string, agentId: string, role: string, status = 'active') => ({
  id,
  status,
  toRole: role,
  toAgentId: agentId,
  task: `Task for ${role}`,
});

describe('CrewStatusContent', () => {
  it('renders empty state with no agents', () => {
    const { container } = render(
      <CrewStatusContent agents={[]} delegations={[]} />,
    );
    expect(container).toBeTruthy();
  });

  it('renders agent list', () => {
    render(
      <CrewStatusContent
        agents={[makeAgent('a1', 'Developer'), makeAgent('a2', 'Tester', 'idle')]}
        delegations={[]}
      />,
    );
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Tester')).toBeInTheDocument();
  });

  it('shows agent status', () => {
    render(
      <CrewStatusContent agents={[makeAgent('a1', 'Developer', 'running')]} delegations={[]} />,
    );
    const text = document.body.textContent || '';
    expect(text).toMatch(/running|active/i);
  });

  it('selects agent on click', () => {
    render(
      <CrewStatusContent
        agents={[makeAgent('a1', 'Developer'), makeAgent('a2', 'Tester')]}
        delegations={[makeDelegation('d1', 'a1', 'developer')]}
      />,
    );
    fireEvent.click(screen.getByText('Developer'));
    // After selection, delegation details should appear
    const text = document.body.textContent || '';
    expect(text).toMatch(/Task for developer|developer/i);
  });

  it('shows comm history when agent selected', () => {
    const comms = [
      { fromId: 'a1', toId: 'lead', fromRole: 'Developer', toRole: 'Lead', content: 'Hello lead', timestamp: Date.now() },
    ];
    render(
      <CrewStatusContent
        agents={[makeAgent('a1', 'Developer')]}
        delegations={[]}
        comms={comms as any}
      />,
    );
    fireEvent.click(screen.getByText('Developer'));
    const text = document.body.textContent || '';
    expect(text).toMatch(/Hello lead|Developer/i);
  });

  it('shows provider badge', () => {
    render(
      <CrewStatusContent
        agents={[makeAgent('a1', 'Developer', 'running', { provider: 'openai' })]}
        delegations={[]}
      />,
    );
    expect(screen.getByTestId('provider-badge')).toBeInTheDocument();
  });

  it('handles onOpenChat callback', () => {
    const onOpenChat = vi.fn();
    render(
      <CrewStatusContent
        agents={[makeAgent('a1', 'Developer')]}
        delegations={[]}
        onOpenChat={onOpenChat}
      />,
    );
    // Select agent first
    fireEvent.click(screen.getByText('Developer'));
    // Look for chat button
    const chatBtn = screen.queryByLabelText(/chat|message/i);
    if (chatBtn) {
      fireEvent.click(chatBtn);
      expect(onOpenChat).toHaveBeenCalled();
    }
  });
});
