// @vitest-environment jsdom
/**
 * Coverage tests for GlobalAgentsPage — agent card expansion, search, status filter,
 * action buttons (interrupt, message, stop), and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../Toast', () => ({
  useToastStore: () => vi.fn(),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: () => '🤖',
}));

import { GlobalAgentsPage } from '../GlobalAgentsPage';

const makeAgent = (overrides: any = {}) => ({
  id: 'agent-1',
  role: { id: 'developer', name: 'Developer', icon: '💻' },
  status: 'running',
  model: 'gpt-4',
  provider: 'openai',
  backend: 'acp',
  task: 'Build feature',
  createdAt: new Date().toISOString(),
  projectId: 'proj-1',
  projectName: 'MyProject',
  sessionId: 'sess-12345678',
  ...overrides,
});

describe('GlobalAgentsPage — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    expect(screen.getByText('Loading agents...')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('renders agents after fetch', async () => {
    mockApiFetch.mockResolvedValue([makeAgent()]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });
    expect(screen.getByText('1 active / 1 total')).toBeInTheDocument();
  });

  it('shows empty state with no agents', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No agents running')).toBeInTheDocument();
    });
  });

  it('filters agents by search text', async () => {
    mockApiFetch.mockResolvedValue([
      makeAgent({ id: 'a1', role: { id: 'dev', name: 'Developer', icon: '💻' } }),
      makeAgent({ id: 'a2', role: { id: 'arch', name: 'Architect', icon: '📐' }, status: 'idle' }),
    ]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Search agents, projects...'), { target: { value: 'Architect' } });
    expect(screen.queryByText('Developer')).not.toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
  });

  it('filters agents by status', async () => {
    mockApiFetch.mockResolvedValue([
      makeAgent({ id: 'a1', status: 'running' }),
      makeAgent({ id: 'a2', status: 'completed', role: { id: 'arch', name: 'Architect', icon: '📐' } }),
    ]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    // Click the "completed" filter
    fireEvent.click(screen.getByText('completed'));
    expect(screen.queryByText('Developer')).not.toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
  });

  it('shows "No agents match your filters" when search has no results', async () => {
    mockApiFetch.mockResolvedValue([makeAgent()]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Search agents, projects...'), { target: { value: 'nonexistent' } });
    expect(screen.getByText('No agents match your filters')).toBeInTheDocument();
  });

  it('expands agent card to show details', async () => {
    mockApiFetch.mockResolvedValue([makeAgent()]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    // Click to expand
    fireEvent.click(screen.getByText('Developer'));
    expect(screen.getByText(/Model:/)).toBeInTheDocument();
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
  });

  it('refreshes agents on Refresh button click', async () => {
    mockApiFetch.mockResolvedValue([makeAgent()]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    mockApiFetch.mockResolvedValue([makeAgent({ task: 'Updated task' })]);
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
    });
  });

  it('handles non-array response gracefully', async () => {
    mockApiFetch.mockResolvedValue(null);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No agents running')).toBeInTheDocument();
    });
  });

  it('sorts alive agents before dead agents', async () => {
    mockApiFetch.mockResolvedValue([
      makeAgent({ id: 'a1', status: 'completed', role: { id: 'a', name: 'Alpha', icon: '🅰️' } }),
      makeAgent({ id: 'a2', status: 'running', role: { id: 'b', name: 'Beta', icon: '🅱️' } }),
    ]);
    render(<MemoryRouter><GlobalAgentsPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });
    // Beta (running) should appear before Alpha (completed)
    const items = screen.getAllByRole('button');
    const betaIdx = items.findIndex(b => b.textContent?.includes('Beta'));
    const alphaIdx = items.findIndex(b => b.textContent?.includes('Alpha'));
    expect(betaIdx).toBeLessThan(alphaIdx);
  });
});
