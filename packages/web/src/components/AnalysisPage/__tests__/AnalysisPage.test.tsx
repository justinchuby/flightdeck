import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalysisPage } from '../AnalysisPage';

// ── Mocks ────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

let mockProjectId: string | null = 'project-1';
vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => mockProjectId,
}));

let mockAgents: Array<{ id: string; projectId?: string; role?: { id: string }; status?: string; inputTokens?: number; outputTokens?: number }> = [];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: { agents: typeof mockAgents }) => unknown) =>
    selector({ agents: mockAgents }),
}));

vi.mock('../../../hooks/useHistoricalAgents', () => ({
  deriveAgentsFromKeyframes: vi.fn(() => []),
}));

vi.mock('../TaskBurndown', () => ({
  CumulativeFlow: ({ data }: { data: unknown[] }) => (
    <div data-testid="cumulative-flow">{data.length} points</div>
  ),
}));

vi.mock('../CostCurve', () => ({
  CostCurve: ({ data }: { data: unknown[] }) => (
    <div data-testid="cost-curve">{data.length} points</div>
  ),
}));

vi.mock('../KeyStats', () => ({
  KeyStats: ({ totalTokens }: { totalTokens: number }) => (
    <div data-testid="key-stats">{totalTokens} tokens</div>
  ),
}));

vi.mock('../../TokenEconomics/CostBreakdown', () => ({
  CostBreakdown: ({ projectId }: { projectId: string }) => (
    <div data-testid="cost-breakdown">{projectId}</div>
  ),
}));

describe('AnalysisPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectId = 'project-1';
    mockAgents = [];
    mockApiFetch.mockResolvedValue({ keyframes: [], tasks: [] });
  });

  it('shows "No project selected" when projectId is null', () => {
    mockProjectId = null;
    render(<AnalysisPage />);
    expect(screen.getByText(/No project selected/)).toBeInTheDocument();
  });

  it('renders all child components when project is active', async () => {
    mockApiFetch.mockResolvedValue({ keyframes: [], tasks: [] });
    render(<AnalysisPage />);

    await waitFor(() => {
      expect(screen.getByTestId('analysis-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('key-stats')).toBeInTheDocument();
    expect(screen.getByTestId('cumulative-flow')).toBeInTheDocument();
    expect(screen.getByTestId('cost-curve')).toBeInTheDocument();
    expect(screen.getByTestId('cost-breakdown')).toBeInTheDocument();
  });

  it('passes projectId to CostBreakdown', async () => {
    render(<AnalysisPage />);
    await waitFor(() => {
      expect(screen.getByTestId('cost-breakdown')).toHaveTextContent('project-1');
    });
  });

  it('renders "Project Analysis" heading', async () => {
    render(<AnalysisPage />);
    await waitFor(() => {
      expect(screen.getByText('Project Analysis')).toBeInTheDocument();
    });
  });

  it('shows session title when lead agent has a task', async () => {
    mockAgents = [
      { id: 'lead-1', projectId: 'project-1', role: { id: 'lead' }, status: 'running', inputTokens: 0, outputTokens: 0 },
    ];
    // Need to add 'task' property
    (mockAgents[0] as Record<string, unknown>).task = 'Build the widget';

    render(<AnalysisPage />);
    await waitFor(() => {
      expect(screen.getByTestId('session-title')).toHaveTextContent('Build the widget');
    });
  });

  it('calls apiFetch for keyframes and tasks on mount', async () => {
    render(<AnalysisPage />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/replay/project-1/keyframes');
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tasks?scope=project&projectId=project-1'),
      );
    });
  });

  it('derives flow data from DAG tasks', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('keyframes')) return Promise.resolve({ keyframes: [] });
      if (url.includes('tasks')) return Promise.resolve({
        tasks: [
          { id: 't1', dagStatus: 'done', createdAt: '2024-01-01T00:00:00Z', startedAt: '2024-01-01T00:01:00Z', completedAt: '2024-01-01T00:02:00Z' },
          { id: 't2', dagStatus: 'running', createdAt: '2024-01-01T00:00:30Z', startedAt: '2024-01-01T00:01:30Z' },
        ],
      });
      return Promise.resolve({});
    });

    render(<AnalysisPage />);
    await waitFor(() => {
      // Should have generated flow points from the task events
      expect(screen.getByTestId('cumulative-flow')).toHaveTextContent(/\d+ points/);
    });
  });

  it('handles API error gracefully — shows empty state', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<AnalysisPage />);

    // Should still render the page (empty charts)
    await waitFor(() => {
      expect(screen.getByTestId('analysis-page')).toBeInTheDocument();
    });
  });
});
