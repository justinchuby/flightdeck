import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppStore } from '../../../stores/appStore';
import type { AgentInfo } from '../../../types';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../../hooks/useApi';
import { TokenUsageSection } from '../TokenUsageSection';

// ── Helpers ─────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'worker', name: 'Worker', icon: '🔧', description: '' },
    status: 'running',
    childIds: [],
    createdAt: '2024-01-01T00:00:00Z',
    outputPreview: '',
    model: 'claude-sonnet',
    projectId: 'proj-1',
    ...overrides,
  } as AgentInfo;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe('TokenUsageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ agents: [] });
  });

  it('shows loading state while fetching', () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));

    render(<TokenUsageSection projectId="proj-1" />, { wrapper: createWrapper() });
    expect(screen.getByText('Loading token usage…')).toBeInTheDocument();
  });

  it('shows empty state when total tokens are zero', async () => {
    vi.mocked(apiFetch).mockResolvedValue([]);

    render(<TokenUsageSection projectId="proj-1" />, { wrapper: createWrapper() });
    expect(await screen.findByText('No token usage recorded yet')).toBeInTheDocument();
  });

  it('renders token summary with data', async () => {
    useAppStore.setState({
      agents: [makeAgent({ id: 'agent-1', projectId: 'proj-1' })],
    });

    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/costs/by-project')) {
        return [{ projectId: 'proj-1', totalInputTokens: 10000, totalOutputTokens: 5000, totalCostUsd: 0.5, sessionCount: 1, agentCount: 1 }];
      }
      if (path.includes('/costs/by-agent')) {
        return [{ agentId: 'agent-1', agentRole: 'worker', totalInputTokens: 10000, totalOutputTokens: 5000, taskCount: 2 }];
      }
      if (path.includes('/costs/by-task')) {
        return [];
      }
      return [];
    });

    render(<TokenUsageSection projectId="proj-1" />, { wrapper: createWrapper() });

    expect(await screen.findByText(/↓10k/)).toBeInTheDocument();
    expect(screen.getByText(/↑5k/)).toBeInTheDocument();
    expect(screen.getByText('15k')).toBeInTheDocument();
    expect(screen.getByText('· 1 agent')).toBeInTheDocument();
  });

  it('expands to show agent breakdown', async () => {
    useAppStore.setState({
      agents: [makeAgent({ id: 'agent-1', projectId: 'proj-1' })],
    });

    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/costs/by-project')) {
        return [{ projectId: 'proj-1', totalInputTokens: 10000, totalOutputTokens: 5000, totalCostUsd: 0.5, sessionCount: 1, agentCount: 1 }];
      }
      if (path.includes('/costs/by-agent')) {
        return [{ agentId: 'agent-1', agentRole: 'worker', totalInputTokens: 10000, totalOutputTokens: 5000, taskCount: 2 }];
      }
      if (path.includes('/costs/by-task')) {
        return [];
      }
      return [];
    });

    render(<TokenUsageSection projectId="proj-1" />, { wrapper: createWrapper() });

    const toggleBtn = await screen.findByRole('button');
    fireEvent.click(toggleBtn);

    expect(screen.getByText('By Agent')).toBeInTheDocument();
    expect(screen.getByText('Worker')).toBeInTheDocument();
  });

  it('shows task breakdown when tasks exist', async () => {
    useAppStore.setState({
      agents: [makeAgent({ id: 'agent-1', projectId: 'proj-1' })],
    });

    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/costs/by-project')) {
        return [{ projectId: 'proj-1', totalInputTokens: 20000, totalOutputTokens: 10000, totalCostUsd: 1.0, sessionCount: 1, agentCount: 1 }];
      }
      if (path.includes('/costs/by-agent')) {
        return [{ agentId: 'agent-1', agentRole: 'worker', totalInputTokens: 20000, totalOutputTokens: 10000, taskCount: 1 }];
      }
      if (path.includes('/costs/by-task')) {
        return [{
          dagTaskId: 'build-ui',
          leadId: 'lead-1',
          totalInputTokens: 20000,
          totalOutputTokens: 10000,
          agentCount: 1,
          agents: [{ agentId: 'agent-1', agentRole: 'worker', inputTokens: 20000, outputTokens: 10000 }],
        }];
      }
      return [];
    });

    render(<TokenUsageSection projectId="proj-1" />, { wrapper: createWrapper() });

    const toggleBtn = await screen.findByRole('button');
    fireEvent.click(toggleBtn);

    const taskToggle = screen.getByText(/By Task/);
    fireEvent.click(taskToggle);

    expect(screen.getByText('build-ui')).toBeInTheDocument();
  });

  it('shows plural "agents" for multiple agents', async () => {
    useAppStore.setState({
      agents: [
        makeAgent({ id: 'agent-1', projectId: 'proj-1' }),
        makeAgent({ id: 'agent-2', projectId: 'proj-1' }),
      ],
    });

    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.includes('/costs/by-project')) {
        return [{ projectId: 'proj-1', totalInputTokens: 5000, totalOutputTokens: 5000, totalCostUsd: 0.3, sessionCount: 1, agentCount: 2 }];
      }
      if (path.includes('/costs/by-agent')) return [];
      if (path.includes('/costs/by-task')) return [];
      return [];
    });

    render(<TokenUsageSection projectId="proj-1" />, { wrapper: createWrapper() });
    expect(await screen.findByText('· 2 agents')).toBeInTheDocument();
  });
});
