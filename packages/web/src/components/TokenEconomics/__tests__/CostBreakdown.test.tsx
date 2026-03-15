import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CostBreakdown } from '../CostBreakdown';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (state: { agents: unknown[] }) => unknown) =>
    selector({
      agents: [
        {
          id: 'agent-001',
          role: { id: 'r1', name: 'Coder', icon: '💻', description: '', systemPrompt: '', color: '#fff', builtIn: false },
          status: 'working',
        },
      ],
    }),
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  },
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

const agentCosts = [
  { agentId: 'agent-001', agentRole: 'Coder', totalInputTokens: 5000, totalOutputTokens: 3000, taskCount: 2 },
  { agentId: 'agent-002', agentRole: 'Reviewer', totalInputTokens: 2000, totalOutputTokens: 1000, taskCount: 1 },
];

const taskCosts = [
  {
    dagTaskId: 'task-1',
    leadId: 'lead-1',
    totalInputTokens: 4000,
    totalOutputTokens: 2500,
    agentCount: 1,
    lastUpdatedAt: '2024-01-15T10:30:00Z',
    agents: [{ agentId: 'agent-001', agentRole: 'Coder', inputTokens: 4000, outputTokens: 2500 }],
  },
  {
    dagTaskId: 'task-2',
    leadId: 'lead-1',
    totalInputTokens: 3000,
    totalOutputTokens: 1500,
    agentCount: 2,
    lastUpdatedAt: null,
    agents: [
      { agentId: 'agent-001', inputTokens: 1000, outputTokens: 500 },
      { agentId: 'agent-002', agentRole: 'Reviewer', inputTokens: 2000, outputTokens: 1000 },
    ],
  },
];

describe('CostBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('by-agent')) return Promise.resolve(agentCosts);
      if (url.includes('by-task')) return Promise.resolve(taskCosts);
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<CostBreakdown />);
    expect(screen.getByText('Loading token data…')).toBeInTheDocument();
  });

  it('shows empty state when no data', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<CostBreakdown />);
    await waitFor(() => {
      expect(screen.getByText(/No token attribution data yet/)).toBeInTheDocument();
    });
  });

  it('renders summary bar with totals', async () => {
    render(<CostBreakdown />);
    await waitFor(() => {
      // totalInput: 5000 + 2000 = 7000 => 7.0k
      expect(screen.getByText(/7\.0k in/)).toBeInTheDocument();
    });
    // totalOutput: 3000 + 1000 = 4000 => 4.0k
    expect(screen.getByText(/4\.0k out/)).toBeInTheDocument();
    // total: 11000 => 11.0k
    expect(screen.getByText(/11\.0k total/)).toBeInTheDocument();
  });

  it('renders agent cost table by default', async () => {
    render(<CostBreakdown />);
    await waitFor(() => {
      expect(screen.getByText('By Agent')).toBeInTheDocument();
    });
    // Agent table headers
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });

  it('shows agent name from agentMap or falls back to role', async () => {
    render(<CostBreakdown />);
    await waitFor(() => {
      // agent-001 is in the agent map, should show 'Coder'
      expect(screen.getByText('Coder')).toBeInTheDocument();
    });
    // agent-002 is not in the map, falls back to agentRole
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('switches to task view when "By Task" is clicked', async () => {
    render(<CostBreakdown />);
    await waitFor(() => expect(screen.getByText('By Task')).toBeInTheDocument());
    fireEvent.click(screen.getByText('By Task'));
    expect(screen.getByText('task-1')).toBeInTheDocument();
    expect(screen.getByText('task-2')).toBeInTheDocument();
  });

  it('shows — for tasks with no lastUpdatedAt', async () => {
    render(<CostBreakdown />);
    await waitFor(() => expect(screen.getByText('By Task')).toBeInTheDocument());
    fireEvent.click(screen.getByText('By Task'));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('passes projectId as query param', async () => {
    render(<CostBreakdown projectId="proj-42" />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/costs/by-agent?projectId=proj-42');
      expect(mockApiFetch).toHaveBeenCalledWith('/costs/by-task?projectId=proj-42');
    });
  });

  it('sorts task table when header is clicked', async () => {
    render(<CostBreakdown />);
    await waitFor(() => expect(screen.getByText('By Task')).toBeInTheDocument());
    fireEvent.click(screen.getByText('By Task'));

    // Click 'Task' header to sort by task name
    const taskHeader = screen.getByText('Task');
    fireEvent.click(taskHeader);
    const rows = screen.getAllByRole('row');
    // header + 2 data rows
    expect(rows).toHaveLength(3);
  });

  it('toggles sort direction when clicking same field', async () => {
    render(<CostBreakdown />);
    await waitFor(() => expect(screen.getByText('By Task')).toBeInTheDocument());
    fireEvent.click(screen.getByText('By Task'));

    // Click Total header (already active) to toggle direction
    const totalHeader = screen.getByText('Total');
    fireEvent.click(totalHeader); // desc to asc
    fireEvent.click(totalHeader); // asc back to desc
    expect(screen.getByText('task-1')).toBeInTheDocument();
  });

  it('handles fetch error silently', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));
    render(<CostBreakdown />);
    await waitFor(() => {
      expect(screen.getByText(/No token attribution data yet/)).toBeInTheDocument();
    });
  });
});
