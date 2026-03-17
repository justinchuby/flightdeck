import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '../../../stores/appStore';
import { PulseStrip } from '../PulseStrip';
import type { AgentInfo } from '../../../types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', systemPrompt: '' },
    status: 'running',
    model: 'gpt-4',
    provider: 'copilot',
    backend: 'acp',
    inputTokens: 0,
    outputTokens: 0,
    contextWindowSize: 0,
    contextWindowUsed: 0,
    contextBurnRate: 0,
    estimatedExhaustionMinutes: null,
    pendingMessages: 0,
    createdAt: new Date().toISOString(),
    childIds: [],
    toolCalls: [],
    messages: [],
    isSubLead: false,
    hierarchyLevel: 0,
    outputPreview: '',
    ...overrides,
  } as AgentInfo;
}

function renderWithRouter(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PulseStrip />
    </MemoryRouter>,
  );
}

describe('PulseStrip', () => {
  beforeEach(() => {
    useAppStore.setState({ agents: [] });
  });

  it('renders nothing when there are no agents', () => {
    const { container } = renderWithRouter();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing on project routes even with agents', () => {
    useAppStore.setState({ agents: [makeAgent()] });
    const { container } = renderWithRouter('/projects/abc123');
    expect(container.innerHTML).toBe('');
  });

  it('renders the strip with running agent count', () => {
    useAppStore.setState({
      agents: [
        makeAgent({ id: 'a1', status: 'running' }),
        makeAgent({ id: 'a2', status: 'running' }),
      ],
    });
    renderWithRouter();
    // Should show a link to /agents
    expect(screen.getByRole('link')).toHaveAttribute('href', '/agents');
    // Running count = 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows idle and failed counts', () => {
    useAppStore.setState({
      agents: [
        makeAgent({ id: 'a1', status: 'running' }),
        makeAgent({ id: 'a2', status: 'idle' }),
        makeAgent({ id: 'a3', status: 'failed' }),
      ],
    });
    renderWithRouter();
    expect(screen.getByText('1', { selector: '.text-green-400' })).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.text-yellow-400' })).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.text-red-400' })).toBeInTheDocument();
  });

  it('does not show status for completed agents', () => {
    useAppStore.setState({
      agents: [
        makeAgent({ id: 'a1', status: 'completed' }),
        makeAgent({ id: 'a2', status: 'running' }),
      ],
    });
    renderWithRouter();
    // Only running count should appear
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows context pressure bars when agents have context data', () => {
    useAppStore.setState({
      agents: [
        makeAgent({
          id: 'a1',
          status: 'running',
          contextWindowSize: 200000,
          contextWindowUsed: 180000,
          role: { id: 'dev', name: 'Developer', systemPrompt: '' },
        }),
      ],
    });
    renderWithRouter();
    // Should show brain icon and pressure bar
    expect(screen.getByTitle(/Context pressure per agent/)).toBeInTheDocument();
    expect(screen.getByTitle(/Developer: 90% context used/)).toBeInTheDocument();
  });

  it('shows overflow indicator when more than 8 agents have context', () => {
    const agents = Array.from({ length: 10 }, (_, i) =>
      makeAgent({
        id: `a${i}`,
        status: 'running',
        contextWindowSize: 200000,
        contextWindowUsed: 50000,
        role: { id: `role-${i}`, name: `Role${i}`, systemPrompt: '' },
      }),
    );
    useAppStore.setState({ agents });
    renderWithRouter();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('does not show pressure section when no agents have context data', () => {
    useAppStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'running', contextWindowSize: 0 })],
    });
    renderWithRouter();
    expect(screen.queryByTitle(/Context pressure/)).not.toBeInTheDocument();
  });
});
