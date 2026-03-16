// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

let mockProjectId: string | null = 'project-1';
vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => mockProjectId,
}));

let mockAgents: any[] = [];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: any) => sel({ agents: mockAgents }),
}));

vi.mock('../../../hooks/useHistoricalAgents', () => ({
  deriveAgentsFromKeyframes: vi.fn(() => []),
}));

let capturedCostData: any[] = [];
let capturedFlowData: any[] = [];
vi.mock('../TaskBurndown', () => ({
  CumulativeFlow: ({ data }: { data: any[] }) => {
    capturedFlowData = data;
    return <div data-testid="cumulative-flow">{data.length} points</div>;
  },
}));
vi.mock('../CostCurve', () => ({
  CostCurve: ({ data }: { data: any[] }) => {
    capturedCostData = data;
    return <div data-testid="cost-curve">{data.length} points</div>;
  },
}));
vi.mock('../KeyStats', () => ({
  KeyStats: ({ totalTokens }: { totalTokens: number }) => <div data-testid="key-stats">{totalTokens}</div>,
}));
vi.mock('../../TokenEconomics/CostBreakdown', () => ({
  CostBreakdown: () => <div data-testid="cost-breakdown" />,
}));

import { AnalysisPage } from '../AnalysisPage';

describe('AnalysisPage – extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectId = 'project-1';
    mockAgents = [];
    capturedCostData = [];
    capturedFlowData = [];
  });

  it('distributes tokens across keyframes for cost curve', async () => {
    mockAgents = [
      { id: 'a1', projectId: 'project-1', role: { id: 'dev' }, status: 'running', inputTokens: 1000, outputTokens: 500 },
    ];
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('keyframes')) {
        return Promise.resolve({
          keyframes: [
            { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
            { type: 'delegation', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a1' },
            { type: 'milestone', timestamp: '2024-01-01T00:02:00Z', label: 'C', agentId: 'a1' },
          ],
        });
      }
      if (url.includes('tasks')) return Promise.resolve({ tasks: [] });
      return Promise.resolve({});
    });

    render(<AnalysisPage />);
    await waitFor(() => {
      expect(capturedCostData.length).toBe(3);
    });
    // Verify progressive cost distribution
    expect(capturedCostData[0].cumulativeCost).toBeCloseTo(1500 * (1/3));
    expect(capturedCostData[1].cumulativeCost).toBeCloseTo(1500 * (2/3));
    expect(capturedCostData[2].cumulativeCost).toBeCloseTo(1500);
    // Verify input/output breakdown
    expect(capturedCostData[2].cumulativeInput).toBeCloseTo(1000);
    expect(capturedCostData[2].cumulativeOutput).toBeCloseTo(500);
  });

  it('creates fallback cost line when no keyframes but tokens exist', async () => {
    mockAgents = [
      { id: 'a1', projectId: 'project-1', role: { id: 'dev' }, status: 'running', inputTokens: 2000, outputTokens: 800 },
    ];
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('keyframes')) return Promise.resolve({ keyframes: [] });
      if (url.includes('tasks')) return Promise.resolve({
        tasks: [{ id: 't1', dagStatus: 'done', createdAt: '2024-01-01T00:00:00Z', startedAt: '2024-01-01T00:01:00Z', completedAt: '2024-01-01T00:02:00Z' }],
      });
      return Promise.resolve({});
    });

    render(<AnalysisPage />);
    await waitFor(() => {
      expect(capturedCostData.length).toBe(2);
    });
    // First point should be zero
    expect(capturedCostData[0].cumulativeCost).toBe(0);
    // Last point should have total tokens
    expect(capturedCostData[1].cumulativeCost).toBe(2800);
    expect(capturedCostData[1].cumulativeInput).toBe(2000);
    expect(capturedCostData[1].cumulativeOutput).toBe(800);
  });

  it('falls back to costs/by-agent API when agent tokens are zero', async () => {
    mockAgents = [
      { id: 'a1', projectId: 'project-1', role: { id: 'dev' }, status: 'idle', inputTokens: 0, outputTokens: 0 },
    ];
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('keyframes')) {
        return Promise.resolve({
          keyframes: [
            { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
          ],
        });
      }
      if (url.includes('tasks')) return Promise.resolve({ tasks: [] });
      if (url.includes('costs/by-agent')) {
        return Promise.resolve([
          { totalInputTokens: 500, totalOutputTokens: 200 },
        ]);
      }
      return Promise.resolve({});
    });

    render(<AnalysisPage />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('costs/by-agent'));
    });
    await waitFor(() => {
      expect(capturedCostData.length).toBe(1);
    });
    expect(capturedCostData[0].cumulativeCost).toBe(700);
  });

  it('derives flow data from keyframes when no DAG tasks', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('keyframes')) {
        return Promise.resolve({
          keyframes: [
            { type: 'delegation', timestamp: '2024-01-01T00:00:00Z', label: 'Task 1', agentId: 'a1' },
            { type: 'milestone', timestamp: '2024-01-01T00:01:00Z', label: 'Done 1', agentId: 'a1' },
            { type: 'delegation', timestamp: '2024-01-01T00:02:00Z', label: 'Task 2', agentId: 'a1' },
          ],
        });
      }
      if (url.includes('tasks')) return Promise.resolve({ tasks: [] });
      return Promise.resolve({});
    });

    render(<AnalysisPage />);
    await waitFor(() => {
      expect(capturedFlowData.length).toBe(3);
    });
    // First delegation: created=1, inProgress=1, completed=0
    expect(capturedFlowData[0].created).toBe(1);
    // After milestone: completed=1, inProgress=0
    expect(capturedFlowData[1].completed).toBe(1);
  });

  it('fallback cost line uses 1 min ago when no dagTasks', async () => {
    mockAgents = [
      { id: 'a1', projectId: 'project-1', role: { id: 'dev' }, status: 'running', inputTokens: 100, outputTokens: 50 },
    ];
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('keyframes')) return Promise.resolve({ keyframes: [] });
      if (url.includes('tasks')) return Promise.resolve({ tasks: [] });
      return Promise.resolve({});
    });

    render(<AnalysisPage />);
    await waitFor(() => {
      expect(capturedCostData.length).toBe(2);
    });
    // Start time should be roughly now - 60000ms
    const timeDiff = capturedCostData[1].time - capturedCostData[0].time;
    expect(timeDiff).toBeGreaterThanOrEqual(59000);
    expect(timeDiff).toBeLessThanOrEqual(61000);
  });
});
