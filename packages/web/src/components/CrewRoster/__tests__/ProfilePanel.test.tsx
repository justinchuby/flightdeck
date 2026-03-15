// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: (sel: (s: any) => any) => sel({ add: mockAddToast }),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: ['gpt-4', 'claude-3'] }),
  deriveModelName: (m: string) => m,
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: (props: any) => {
    const items = props?.items || [];
    return (
      <div data-testid="tabs">
        {items.map((item: any) => (
          <button key={item.value} onClick={() => props.onSelect?.(item.value)}>{item.label}</button>
        ))}
      </div>
    );
  },
}));

vi.mock('../utils', () => ({
  statusBadge: (status: string) => `badge-${status}`,
}));

import { ProfilePanel } from '../ProfilePanel';

const makeProfile = (overrides = {}) => ({
  agentId: 'agent-1',
  role: 'developer',
  model: 'gpt-4',
  status: 'running' as const,
  liveStatus: 'running' as const,
  teamId: 'team-1',
  projectId: 'proj-1',
  lastTaskSummary: 'Implemented auth feature',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T01:00:00Z',
  knowledgeCount: 5,
  live: {
    task: 'Working on frontend tests',
    outputPreview: 'Running vitest...',
    model: 'gpt-4',
    sessionId: 'sess-1',
    provider: 'openai',
    backend: 'acp',
    exitError: null,
  },
  ...overrides,
});

describe('ProfilePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(makeProfile());
  });

  it('shows loading state initially', () => {
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Loading profile/)).toBeInTheDocument();
  });

  it('renders profile after load', async () => {
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/developer/i)).toBeInTheDocument();
    });
  });

  it('shows agent model', async () => {
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    await waitFor(() => {
      const text = document.body.textContent || '';
      expect(text).toMatch(/gpt-4/i);
    });
  });

  it('shows live task info', async () => {
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Working on frontend tests/)).toBeInTheDocument();
    });
  });

  it('shows error state on load failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Not found'));
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Profile not found/)).toBeInTheDocument();
    });
  });

  it('has tab navigation', async () => {
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText(/developer/i));
    expect(screen.getByTestId('tabs')).toBeInTheDocument();
  });

  it('calls API with correct path', async () => {
    render(<ProfilePanel agentId="agent-1" crewId="team-1" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/crews/team-1/agents/agent-1/profile');
    });
  });
});
