import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CrewGroup } from '../CrewGroup';
import type { RosterAgent, CrewSummary } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: (role: string) => role === 'lead' ? '👑' : '🤖',
}));

vi.mock('../../../utils/statusColors', () => ({
  sessionStatusDot: () => 'bg-green-400',
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n: number | null) => n != null ? `${n}` : '0',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makeAgent(overrides: Partial<RosterAgent> = {}): RosterAgent {
  return {
    agentId: 'agent-001',
    role: 'developer',
    model: 'gpt-4',
    status: 'idle',
    liveStatus: null,
    teamId: 'team-1',
    projectId: 'proj-1',
    parentId: null,
    sessionId: null,
    lastTaskSummary: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    provider: null,
    inputTokens: null,
    outputTokens: null,
    contextWindowSize: null,
    contextWindowUsed: null,
    task: null,
    outputPreview: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<CrewSummary> = {}): CrewSummary {
  return {
    leadId: 'lead-001',
    projectId: 'proj-1',
    projectName: 'Test Project',
    agentCount: 2,
    activeAgentCount: 1,
    sessionCount: 3,
    lastActivity: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const defaultProps = () => ({
  leadId: 'lead-001',
  agents: [
    makeAgent({ agentId: 'lead-001', role: 'lead', model: 'gpt-4' }),
    makeAgent({ agentId: 'agent-002', role: 'developer', model: 'claude-3' }),
  ],
  summary: makeSummary(),
  defaultExpanded: true,
  onSelectAgent: vi.fn(),
  selectedAgentId: null,
  onDeleteCrew: vi.fn().mockResolvedValue(undefined),
});

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue([]);
});

describe('CrewGroup', () => {
  it('renders group header with project name', async () => {
    render(<CrewGroup {...defaultProps()} />);
    await act(async () => {});
    expect(screen.getByText('Test Project')).toBeTruthy();
  });

  it('shows active agent count badge when agents are active', async () => {
    render(<CrewGroup {...defaultProps()} />);
    await act(async () => {});
    expect(screen.getByText('1/2 active')).toBeTruthy();
  });

  it('shows total agent count when none are active', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ activeAgentCount: 0 });
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.getByText('2 agents')).toBeTruthy();
  });

  it('renders agent rows when expanded', async () => {
    render(<CrewGroup {...defaultProps()} />);
    await act(async () => {});
    // Lead and developer agent rows should be visible
    expect(screen.getByText('lead')).toBeTruthy();
    expect(screen.getByText('developer')).toBeTruthy();
  });

  it('hides agent rows when collapsed', async () => {
    render(<CrewGroup {...defaultProps()} defaultExpanded={false} />);
    await act(async () => {});
    expect(screen.queryByText('developer')).toBeNull();
  });

  it('toggles expand/collapse on header click', async () => {
    render(<CrewGroup {...defaultProps()} defaultExpanded={true} />);
    await act(async () => {});
    expect(screen.getByText('developer')).toBeTruthy();

    // Click the header toggle button
    const toggleBtn = screen.getByText('Test Project').closest('button')!;
    await act(async () => { fireEvent.click(toggleBtn); });
    expect(screen.queryByText('developer')).toBeNull();

    await act(async () => { fireEvent.click(toggleBtn); });
    expect(screen.getByText('developer')).toBeTruthy();
  });

  it('calls onSelectAgent when agent row is clicked', async () => {
    const props = defaultProps();
    render(<CrewGroup {...props} />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByText('developer')); });
    expect(props.onSelectAgent).toHaveBeenCalledWith('agent-002');
  });

  it('shows delete button only when crew is inactive', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ activeAgentCount: 0 });
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', liveStatus: null, status: 'terminated' }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.getByTitle('Delete crew')).toBeTruthy();
  });

  it('hides delete button when agents are active', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ activeAgentCount: 1 });
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', liveStatus: 'running' }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.queryByTitle('Delete crew')).toBeNull();
  });

  it('shows delete confirmation dialog', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ activeAgentCount: 0 });
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', status: 'terminated', liveStatus: null }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});

    await act(async () => { fireEvent.click(screen.getByTitle('Delete crew')); });
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
  });

  it('calls onDeleteCrew when confirmed', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ activeAgentCount: 0 });
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', status: 'terminated', liveStatus: null }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});

    await act(async () => { fireEvent.click(screen.getByTitle('Delete crew')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });

    await waitFor(() => {
      expect(props.onDeleteCrew).toHaveBeenCalledWith('lead-001');
    });
  });

  it('cancels delete confirmation', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ activeAgentCount: 0 });
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', status: 'terminated', liveStatus: null }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});

    await act(async () => { fireEvent.click(screen.getByTitle('Delete crew')); });
    expect(screen.getByText('Cancel')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('highlights selected agent row', async () => {
    const props = defaultProps();
    props.selectedAgentId = 'agent-002';
    render(<CrewGroup {...props} />);
    await act(async () => {});
    // The selected agent button should have the selected class
    const agentBtn = screen.getByText('developer').closest('button')!;
    expect(agentBtn.className).toContain('border-blue-500');
  });

  it('falls back to crew ID when no project name', async () => {
    const props = defaultProps();
    props.summary = makeSummary({ projectName: null, projectId: null });
    props.agents = [makeAgent({ agentId: 'lead-001', role: 'lead', projectId: null })];
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.getByText('Crew lead-001')).toBeTruthy();
  });

  it('displays session count in header', async () => {
    render(<CrewGroup {...defaultProps()} />);
    await act(async () => {});
    expect(screen.getByText(/3 sessions/)).toBeTruthy();
  });

  it('shows agent token usage when present', async () => {
    const props = defaultProps();
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', inputTokens: 1000, outputTokens: 500 }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.getByText('↓1000')).toBeTruthy();
    expect(screen.getByText('↑500')).toBeTruthy();
  });

  it('shows agent task description when present', async () => {
    const props = defaultProps();
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', task: 'Implement auth module' }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.getByText(/Implement auth module/)).toBeTruthy();
  });

  it('fetches sessions when expanded and projectId is available', async () => {
    mockApiFetch.mockResolvedValue([
      { id: 's1', leadId: 'lead-001', status: 'running', task: 'Build feature', startedAt: '2025-01-01T00:00:00Z', endedAt: null, durationMs: null, taskSummary: { total: 5, done: 3, failed: 0 }, hasRetro: false },
    ]);

    render(<CrewGroup {...defaultProps()} />);
    await act(async () => {});

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/sessions/detail');
    });

    await waitFor(() => {
      expect(screen.getByText('Build feature')).toBeTruthy();
    });
  });

  it('shows provider badge on agent when present', async () => {
    const props = defaultProps();
    props.agents = [
      makeAgent({ agentId: 'lead-001', role: 'lead', provider: 'anthropic' }),
    ];
    render(<CrewGroup {...props} />);
    await act(async () => {});
    expect(screen.getByText('anthropic')).toBeTruthy();
  });
});
