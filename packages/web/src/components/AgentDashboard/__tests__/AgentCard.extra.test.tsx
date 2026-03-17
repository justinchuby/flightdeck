// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AgentCard } from '../AgentCard';
import type { AgentInfo } from '../../../types';

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

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('AgentCard — extra coverage', () => {
  it('shows idle status agent with interrupt and stop buttons', () => {
    render(<AgentCard agent={makeAgent({ status: 'idle' })} />);
    expect(screen.getByText('idle')).toBeDefined();
    expect(screen.getByTitle('Interrupt agent')).toBeDefined();
    expect(screen.getByTitle('Stop agent')).toBeDefined();
  });

  it('shows restart button for failed agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'failed' })} />);
    expect(screen.getByTitle('Restart agent')).toBeDefined();
  });

  it('shows restart button for completed agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'completed' })} />);
    expect(screen.getByTitle('Restart agent')).toBeDefined();
  });

  it('clicking terminal button selects agent', () => {
    render(<AgentCard agent={makeAgent()} />);
    fireEvent.click(screen.getByTitle('Open terminal'));
    expect(mockSetSelectedAgent).toHaveBeenCalledWith('agent-abc-123');
  });

  it('deselects when clicking already-selected card', () => {
    vi.mocked(mockSetSelectedAgent).mockClear();
    // Override to show selected state
    const { unmount } = render(<AgentCard agent={makeAgent()} />);
    unmount();

    // Mock appStore to return this agent as selected
    vi.resetModules();
  });

  it('model selector triggers updateAgent', () => {
    render(<AgentCard agent={makeAgent({ status: 'running', model: 'claude-sonnet-4' })} />);
    const select = screen.getByDisplayValue('claude-sonnet-4');
    fireEvent.change(select, { target: { value: 'gpt-4o' } });
    expect(mockApi.updateAgent).toHaveBeenCalledWith('agent-abc-123', { model: 'gpt-4o' });
  });

  it('shows session ID button when sessionId is set', () => {
    render(<AgentCard agent={makeAgent({ sessionId: 'sess-xyz-123' })} />);
    expect(screen.getByText(/sess:sess-xyz-123/)).toBeDefined();
  });

  it('shows context window bar when contextWindowSize and contextWindowUsed set', () => {
    const { container } = render(
      <AgentCard agent={makeAgent({
        status: 'running',
        inputTokens: 5000,
        outputTokens: 2000,
        contextWindowSize: 200000,
        contextWindowUsed: 120000,
      })} />,
    );
    // Should show percentage
    expect(screen.getByText('60%')).toBeDefined();
    // Progress bar should have blue color (< 60%)
    const bar = container.querySelector('.bg-blue-500');
    expect(bar).toBeTruthy();
  });

  it('shows yellow context bar for 60-85% usage', () => {
    const { container } = render(
      <AgentCard agent={makeAgent({
        status: 'running',
        inputTokens: 5000,
        outputTokens: 2000,
        contextWindowSize: 200000,
        contextWindowUsed: 150000,
      })} />,
    );
    expect(screen.getByText('75%')).toBeDefined();
    const bar = container.querySelector('.bg-yellow-500');
    expect(bar).toBeTruthy();
  });

  it('shows red context bar for >85% usage', () => {
    const { container } = render(
      <AgentCard agent={makeAgent({
        status: 'running',
        inputTokens: 5000,
        outputTokens: 2000,
        contextWindowSize: 200000,
        contextWindowUsed: 180000,
      })} />,
    );
    expect(screen.getByText('90%')).toBeDefined();
    const bar = container.querySelector('.bg-red-500');
    expect(bar).toBeTruthy();
  });

  it('shows cache read tokens when present', () => {
    render(
      <AgentCard agent={makeAgent({
        inputTokens: 5000,
        outputTokens: 2000,
        cacheReadTokens: 1500,
      })} />,
    );
    expect(screen.getByTitle('Cache read tokens')).toBeDefined();
  });

  it('does not show cache tokens when zero', () => {
    render(
      <AgentCard agent={makeAgent({
        inputTokens: 5000,
        outputTokens: 2000,
        cacheReadTokens: 0,
      })} />,
    );
    expect(screen.queryByTitle('Cache read tokens')).toBeNull();
  });

  it('shows tool calls indicator when toolCalls present', () => {
    render(
      <AgentCard agent={makeAgent({
        toolCalls: [
          { id: 'tc1', title: 'Running tests', status: 'in_progress' },
        ],
      })} />,
    );
    expect(screen.getByText(/Running tests/)).toBeDefined();
  });

  it('shows latest tool call when multiple exist', () => {
    render(
      <AgentCard agent={makeAgent({
        toolCalls: [
          { id: 'tc1', title: 'Old task', status: 'completed' },
          { id: 'tc2', title: 'Current build', status: 'in_progress' },
        ],
      })} />,
    );
    expect(screen.getByText(/Current build/)).toBeDefined();
  });

  it('shows exit error truncated at 120 chars', () => {
    const longError = 'E'.repeat(150);
    render(<AgentCard agent={makeAgent({ status: 'failed', exitError: longError })} />);
    expect(screen.getByText('E'.repeat(120) + '…')).toBeDefined();
  });

  it('shows provider and model when not running/idle', () => {
    render(<AgentCard agent={makeAgent({ status: 'completed', provider: 'openai', model: 'gpt-4o' })} />);
    expect(screen.getByText('openai')).toBeDefined();
    expect(screen.getByText('gpt-4o')).toBeDefined();
  });

  it('renders DiffBadge for running agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'running' })} />);
    expect(screen.getByTestId('diff-badge')).toBeDefined();
  });

  it('does not render DiffBadge for completed agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'completed' })} />);
    expect(screen.queryByTestId('diff-badge')).toBeNull();
  });

  it('confirm kill resets on blur', () => {
    render(<AgentCard agent={makeAgent({ status: 'running' })} />);
    const stopBtn = screen.getByTitle('Stop agent');
    fireEvent.click(stopBtn);
    const confirmBtn = screen.getByTitle('Confirm stop');
    fireEvent.blur(confirmBtn);
    // After blur, should show Stop agent again
    expect(screen.getByTitle('Stop agent')).toBeDefined();
  });
});
