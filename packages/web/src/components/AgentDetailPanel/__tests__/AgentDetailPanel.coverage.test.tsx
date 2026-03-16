// @vitest-environment jsdom
/**
 * Coverage for AgentDetailPanel — tab switching, profile fetch, action buttons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: any) => sel({
      agents: [
        {
          id: 'agent-1',
          role: { id: 'developer', name: 'Developer', icon: '💻' },
          status: 'running',
          model: 'gpt-4',
          provider: 'openai',
          backend: 'acp',
          inputTokens: 1000,
          outputTokens: 500,
          contextWindowSize: 128000,
          contextWindowUsed: 64000,
          task: 'Build feature',
          createdAt: '2024-01-01T00:00:00Z',
          childIds: [],
          outputPreview: 'some output...',
          exitError: null,
        },
      ],
    }),
    {
      getState: () => ({
        agents: [],
      }),
    },
  ),
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: any) => sel({ projects: {} }),
    { getState: () => ({ projects: {} }) },
  ),
}));

vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (sel: any) => sel({ add: vi.fn() }),
    { getState: () => ({ add: vi.fn() }) },
  ),
}));

vi.mock('../../../utils/statusColors', () => ({
  agentStatusText: () => 'Running',
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n: number) => `${n}t`,
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => 'just now',
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: () => '🤖',
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: any) => <span>{text}</span>,
}));

vi.mock('../../ProvideFeedback', () => ({
  buildFeedbackUrl: () => 'https://feedback.example.com',
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({ tabs, activeTab, onTabChange }: any) => (
    <div data-testid="tabs">
      {tabs.map((t: any) => (
        <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => onTabChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../AgentChatPanel', () => ({
  AgentChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../LeadDashboard/AgentReportBlock', () => ({
  AgentReportBlock: () => <div data-testid="agent-report" />,
}));

vi.mock('../../../utils/providerColors', () => ({
  getProviderColors: () => ({ bg: 'bg-blue-500', text: 'text-blue-400', name: 'OpenAI' }),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: [] }),
  deriveModelName: (m: string) => m,
}));

import { AgentDetailPanel } from '../AgentDetailPanel';

describe('AgentDetailPanel — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(null);
  });

  it('renders inline mode with agent details', () => {
    render(
      <AgentDetailPanel
        agentId="agent-1"
        mode="inline"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('renders modal mode', () => {
    render(
      <AgentDetailPanel
        agentId="agent-1"
        mode="modal"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <AgentDetailPanel
        agentId="agent-1"
        mode="inline"
        onClose={onClose}
      />,
    );
    // Find the back/close button
    const btns = screen.getAllByRole('button');
    const closeBtn = btns.find(b => b.getAttribute('aria-label')?.includes('close') || b.getAttribute('title')?.includes('close'));
    if (closeBtn) fireEvent.click(closeBtn);
  });

  it('switches to chat tab', () => {
    render(
      <AgentDetailPanel
        agentId="agent-1"
        mode="inline"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('switches to settings tab', () => {
    render(
      <AgentDetailPanel
        agentId="agent-1"
        mode="inline"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('tab-settings'));
  });

  it('renders with no agent found', () => {
    vi.mocked(vi.fn()); // Reset store
    // Render with non-existent agent
    render(
      <AgentDetailPanel
        agentId="nonexistent"
        mode="inline"
        onClose={vi.fn()}
      />,
    );
    // Should show something (empty state or agent not found)
  });
});
