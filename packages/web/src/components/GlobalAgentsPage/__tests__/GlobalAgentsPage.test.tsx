// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GlobalAgentsPage } from '../GlobalAgentsPage';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../Toast', () => ({
  useToastStore: () => vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <GlobalAgentsPage />
    </MemoryRouter>,
  );
}

// ── Fixtures ──────────────────────────────────────────────

const agentList = [
  {
    id: 'aaa-111',
    role: { id: 'architect', name: 'Architect', icon: '🏗', model: 'sonnet', color: 'blue' },
    status: 'running',
    autopilot: true,
    task: 'Design auth module',
    sessionId: 'sess-abc-123-456',
    projectName: 'MyProject',
    projectId: 'proj-1',
    model: 'claude-sonnet-4-6',
    createdAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'bbb-222',
    role: { id: 'developer', name: 'Developer', icon: '👨‍💻', model: 'sonnet', color: 'green' },
    status: 'idle',
    autopilot: false,
    task: null,
    sessionId: null,
    projectName: null,
    projectId: null,
    model: 'claude-sonnet-4-6',
    createdAt: '2026-03-02T10:00:00Z',
  },
  {
    id: 'ccc-333',
    role: { id: 'reviewer', name: 'Reviewer', icon: '🔍', model: 'opus', color: 'red' },
    status: 'terminated',
    autopilot: false,
    task: 'Final review',
    sessionId: 'sess-xyz-789',
    projectName: 'OtherProject',
    projectId: 'proj-2',
    model: 'claude-opus-4.6',
    createdAt: '2026-03-01T08:00:00Z',
  },
];

// ── Tests ─────────────────────────────────────────────────

describe('GlobalAgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading agents/i)).toBeInTheDocument();
  });

  it('shows error on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('renders all agents', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('shows active/total counts', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      // 2 alive (running + idle), 3 total
      expect(screen.getByText('2 active / 3 total')).toBeInTheDocument();
    });
  });

  it('shows role emoji on agent cards', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('🏗')).toBeInTheDocument();
    });
  });

  it('shows status badges', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('Terminated')).toBeInTheDocument();
  });

  it('shows project name and session ID', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('📁 MyProject')).toBeInTheDocument();
    });
    expect(screen.getByText('🔗 sess-abc-1')).toBeInTheDocument();
  });

  it('filters by search text', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search agents/i), { target: { value: 'Developer' } });
    expect(screen.queryByText('Architect')).not.toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('filters by project name', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search agents/i), { target: { value: 'OtherProject' } });
    expect(screen.queryByText('Architect')).not.toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'running' }));
    // Only the running agent should remain
    expect(screen.getByText('Architect')).toBeInTheDocument();
    expect(screen.queryByText('Developer')).not.toBeInTheDocument();
    expect(screen.queryByText('Reviewer')).not.toBeInTheDocument();
  });

  it('shows empty state', async () => {
    mockApiFetch.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no agents running/i)).toBeInTheDocument();
    });
  });

  it('shows filter empty state', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search agents/i), { target: { value: 'zzzzz' } });
    expect(screen.getByText(/no agents match your filters/i)).toBeInTheDocument();
  });

  // ── Expanded card + actions ──────────────────────────────

  it('expands card to show details', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    // Click the architect card to expand
    fireEvent.click(screen.getByText('Architect'));
    await waitFor(() => {
      expect(screen.getByText('Autopilot:')).toBeInTheDocument();
    });
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('shows action buttons for live agents', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Architect'));
    await waitFor(() => {
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
      expect(screen.getByText('Message')).toBeInTheDocument();
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });
  });

  it('sends interrupt', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Architect'));
    await waitFor(() => {
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Interrupt'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/aaa-111/interrupt', { method: 'POST' });
    });
  });

  it('shows stop confirmation dialog', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Architect'));
    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText(/terminate this agent/i)).toBeInTheDocument();
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
    });
  });

  it('sends terminate on confirm', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Architect'));
    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Confirm Stop'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/aaa-111/terminate', { method: 'POST' });
    });
  });

  it('shows message input and sends', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Architect'));
    await waitFor(() => {
      expect(screen.getByText('Message')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Message'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/type a message/i), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/agents/aaa-111/message',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello' }),
        }),
      );
    });
  });

  it('does not show action buttons for terminated agents', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Reviewer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Reviewer'));
    await waitFor(() => {
      expect(screen.getByText('Model:')).toBeInTheDocument();
    });
    expect(screen.queryByText('Interrupt')).not.toBeInTheDocument();
  });

  it('refreshes agent list', async () => {
    mockApiFetch.mockResolvedValue(agentList);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(2); // initial + refresh
    });
  });
});
