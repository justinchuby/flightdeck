import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseFocusAgent = vi.fn();
vi.mock('../../../hooks/useFocusAgent', () => ({
  useFocusAgent: (...args: unknown[]) => mockUseFocusAgent(...args),
}));

vi.mock('../../DiffPreview', () => ({
  DiffPreview: ({ diff }: { diff: unknown }) => <div data-testid="diff-preview">{JSON.stringify(diff)}</div>,
}));

vi.mock('../../Shared', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  SkeletonCard: () => <div data-testid="skeleton-card">Loading...</div>,
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({ tabs, activeTab, onTabChange }: { tabs: { id: string; label: string }[]; activeTab: string; onTabChange: (id: string) => void }) => (
    <div data-testid="tabs">
      {tabs.map((t) => (
        <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => onTabChange(t.id)} aria-selected={activeTab === t.id}>
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

import { FocusPanel } from '../FocusPanel';

const mockAgent = {
  id: 'agent-001-full',
  role: { id: 'r1', name: 'Coder', icon: '💻', description: '', systemPrompt: '', color: '#fff', builtIn: false },
  status: 'working',
  model: 'sonnet',
  provider: 'anthropic',
  contextBurnRate: 12.5,
};

const mockDecisions = [
  { id: 'd1', title: 'Use React', rationale: 'Better ecosystem' },
  { id: 'd2', title: 'Add tests', rationale: 'Improve coverage' },
];

const mockActivities = [
  { id: 'a1', action: 'file_edit', agentId: 'agent-001', details: 'Edited App.tsx', timestamp: '2024-01-01T00:00:00Z' },
];

const mockDiff = {
  agentId: 'agent-001-full',
  files: [],
  summary: { additions: 10, deletions: 5, fileCount: 2 },
  cachedAt: '2024-01-01T00:00:00Z',
};

describe('FocusPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFocusAgent.mockReturnValue({
      data: {
        agent: mockAgent,
        recentOutput: 'hello',
        activities: mockActivities,
        decisions: mockDecisions,
        fileLocks: [],
        diff: mockDiff,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it('renders with agent data in overview tab', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    expect(screen.getByTestId('canvas-focus-panel')).toBeInTheDocument();
    expect(screen.getByText('💻')).toBeInTheDocument();
    expect(screen.getByText(/Coder/)).toBeInTheDocument();
    expect(screen.getByText(/agent-00/)).toBeInTheDocument();
    expect(screen.getAllByText('working').length).toBeGreaterThanOrEqual(1);
    // Overview tab shows provider, model, status, burn rate
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('sonnet')).toBeInTheDocument();
    expect(screen.getByText('12.5 tok/s')).toBeInTheDocument();
  });

  it('calls onClose when X button is clicked', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    const headerDiv = screen.getByText(/Coder/).closest('.flex.items-center');
    const closeBtn = headerDiv?.querySelector('button');
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows loading skeleton when loading without data', () => {
    mockUseFocusAgent.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });

  it('does not show skeleton when loading with existing data', () => {
    mockUseFocusAgent.mockReturnValue({
      data: { agent: mockAgent, recentOutput: '', activities: [], decisions: [], fileLocks: [], diff: null },
      loading: true,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    expect(screen.queryByTestId('skeleton-card')).not.toBeInTheDocument();
  });

  it('shows error message', () => {
    mockUseFocusAgent.mockReturnValue({
      data: null,
      loading: false,
      error: 'Something went wrong',
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('switches to tasks tab and shows decisions', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-tasks'));
    expect(screen.getByText('Use React')).toBeInTheDocument();
    expect(screen.getByText('Better ecosystem')).toBeInTheDocument();
    expect(screen.getByText('Add tests')).toBeInTheDocument();
  });

  it('shows empty state for tasks when no decisions', () => {
    mockUseFocusAgent.mockReturnValue({
      data: { agent: mockAgent, recentOutput: '', activities: [], decisions: [], fileLocks: [], diff: null },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-tasks'));
    expect(screen.getByText('No decisions recorded')).toBeInTheDocument();
  });

  it('switches to messages tab and shows activities', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-messages'));
    expect(screen.getByText('Edited App.tsx')).toBeInTheDocument();
  });

  it('shows empty state for messages when no activities', () => {
    mockUseFocusAgent.mockReturnValue({
      data: { agent: mockAgent, recentOutput: '', activities: [], decisions: [], fileLocks: [], diff: null },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-messages'));
    expect(screen.getByText('No recent messages')).toBeInTheDocument();
  });

  it('switches to metrics tab', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-metrics'));
    expect(screen.getByText(/Token usage and cost metrics/)).toBeInTheDocument();
  });

  it('switches to diff tab and shows DiffPreview', () => {
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-diff'));
    expect(screen.getByTestId('diff-preview')).toBeInTheDocument();
  });

  it('shows no changes message when diff is null', () => {
    mockUseFocusAgent.mockReturnValue({
      data: { agent: mockAgent, recentOutput: '', activities: [], decisions: [], fileLocks: [], diff: null },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-diff'));
    expect(screen.getByText('No uncommitted changes')).toBeInTheDocument();
  });

  it('shows default Agent name when agent has no role name', () => {
    mockUseFocusAgent.mockReturnValue({
      data: {
        agent: { ...mockAgent, role: undefined },
        recentOutput: '',
        activities: [],
        decisions: [],
        fileLocks: [],
        diff: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    expect(screen.getByText(/Agent/)).toBeInTheDocument();
  });

  it('shows default model when agent has no model', () => {
    mockUseFocusAgent.mockReturnValue({
      data: {
        agent: { ...mockAgent, model: undefined },
        recentOutput: '',
        activities: [],
        decisions: [],
        fileLocks: [],
        diff: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<FocusPanel agentId="agent-001-full" onClose={onClose} />);
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('passes agentId to useFocusAgent', () => {
    render(<FocusPanel agentId="my-agent-id" onClose={onClose} />);
    expect(mockUseFocusAgent).toHaveBeenCalledWith('my-agent-id');
  });
});
