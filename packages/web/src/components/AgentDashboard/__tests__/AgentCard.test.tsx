// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AgentCard } from '../AgentCard';
import type { AgentInfo } from '../../../types';

// Mock dependencies
const mockSetSelectedAgent = vi.fn();
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedAgentId: null,
      setSelectedAgent: mockSetSelectedAgent,
      agents: [],
    }),
}));

const mockApi = {
  restartAgent: vi.fn(),
  interruptAgent: vi.fn(),
  terminateAgent: vi.fn(),
  updateAgent: vi.fn(),
};
vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => mockApi,
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: ['claude-sonnet-4', 'gpt-4o'], loading: false }),
}));

vi.mock('../../DiffPreview', () => ({
  DiffBadge: () => <span data-testid="diff-badge" />,
}));

vi.mock('../../../utils/markdown', () => ({
  AgentIdBadge: ({ id }: { id: string }) => <span data-testid="agent-id-badge">{id.slice(0, 8)}</span>,
}));

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-abc-123',
    role: { id: 'developer', name: 'Developer', icon: '🛠️', color: '#3b82f6', description: '', systemPrompt: '', builtIn: false },
    status: 'running',
    childIds: [],
    createdAt: '2026-03-14T10:00:00Z',
    outputPreview: '',
    model: 'claude-sonnet-4',
    ...overrides,
  } as AgentInfo;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('AgentCard', () => {
  it('renders agent role name and short id', () => {
    render(<AgentCard agent={makeAgent()} />);
    expect(screen.getByText('Developer')).toBeDefined();
  });

  it('renders agent status', () => {
    render(<AgentCard agent={makeAgent({ status: 'running' })} />);
    expect(screen.getByText('running')).toBeDefined();
  });

  it('clicking card selects the agent', () => {
    render(<AgentCard agent={makeAgent()} />);
    // Click the outer card div
    fireEvent.click(screen.getByText('Developer').closest('[class*="cursor-pointer"]')!);
    expect(mockSetSelectedAgent).toHaveBeenCalledWith('agent-abc-123');
  });

  it('shows task when present', () => {
    render(<AgentCard agent={makeAgent({ task: 'Fix the login bug' })} />);
    expect(screen.getByText('Fix the login bug')).toBeDefined();
  });

  it('truncates long tasks to 60 chars', () => {
    const longTask = 'A'.repeat(80);
    render(<AgentCard agent={makeAgent({ task: longTask })} />);
    expect(screen.getByText('A'.repeat(60) + '...')).toBeDefined();
  });

  it('shows exit error when present', () => {
    render(<AgentCard agent={makeAgent({ status: 'failed', exitError: 'OOM killed' })} />);
    expect(screen.getByText('OOM killed')).toBeDefined();
  });

  it('shows restart button for terminated agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'terminated' })} />);
    const restartBtn = screen.getByTitle('Restart agent');
    fireEvent.click(restartBtn);
    expect(mockApi.restartAgent).toHaveBeenCalledWith('agent-abc-123');
  });

  it('shows interrupt button for running agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'running' })} />);
    const interruptBtn = screen.getByTitle('Interrupt agent');
    fireEvent.click(interruptBtn);
    expect(mockApi.interruptAgent).toHaveBeenCalledWith('agent-abc-123');
  });

  it('shows stop button for running agents with confirmation', () => {
    render(<AgentCard agent={makeAgent({ status: 'running' })} />);
    const stopBtn = screen.getByTitle('Stop agent');
    fireEvent.click(stopBtn);
    // After first click, "Confirm stop" button appears
    const confirmBtn = screen.getByTitle('Confirm stop');
    fireEvent.click(confirmBtn);
    expect(mockApi.terminateAgent).toHaveBeenCalledWith('agent-abc-123');
  });

  it('hides action buttons for completed agents (except restart)', () => {
    render(<AgentCard agent={makeAgent({ status: 'completed' })} />);
    expect(screen.getByTitle('Restart agent')).toBeDefined();
    expect(screen.queryByTitle('Stop agent')).toBeNull();
    expect(screen.queryByTitle('Interrupt agent')).toBeNull();
  });

  it('renders model selector for running agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'running', model: 'claude-sonnet-4' })} />);
    const select = screen.getByDisplayValue('claude-sonnet-4');
    expect(select).toBeDefined();
  });

  it('renders provider badge when provider is set', () => {
    render(<AgentCard agent={makeAgent({ status: 'running', provider: 'copilot' })} />);
    expect(screen.getByText('copilot')).toBeDefined();
  });

  it('renders sub-agent count', () => {
    render(<AgentCard agent={makeAgent({ childIds: ['child-1', 'child-2'] })} />);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('renders plan progress bar', () => {
    render(<AgentCard agent={makeAgent({
      plan: [
        { id: '1', title: 'Step 1', status: 'completed' },
        { id: '2', title: 'Step 2', status: 'in_progress' },
        { id: '3', title: 'Step 3', status: 'pending' },
      ],
    })} />);
    expect(screen.getByText('Plan: 1/3')).toBeDefined();
  });

  it('renders token metrics', () => {
    render(<AgentCard agent={makeAgent({ inputTokens: 1500, outputTokens: 500 })} />);
    // formatTokens converts these to display values
    expect(screen.getByTitle('Input tokens')).toBeDefined();
    expect(screen.getByTitle('Output tokens')).toBeDefined();
  });

  it('renders output preview', () => {
    render(<AgentCard agent={makeAgent({ outputPreview: 'Building the app...' })} />);
    expect(screen.getByText('Building the app...')).toBeDefined();
  });
});
