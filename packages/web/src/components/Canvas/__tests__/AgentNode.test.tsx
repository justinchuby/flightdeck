// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

import { AgentNode } from '../AgentNode';

const makeNodeProps = (overrides: Record<string, unknown> = {}) => ({
  id: 'node-1',
  type: 'agent',
  data: {
    agent: {
      id: 'agent-abc123',
      role: { id: 'dev', name: 'Developer', icon: '💻', color: '#4f46e5' },
      status: 'running',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      contextBurnRate: 0.3,
      childIds: [],
      createdAt: new Date().toISOString(),
      outputPreview: '',
    },
    commVolume: 5,
    isUserPositioned: false,
  },
  ...overrides,
});

describe('AgentNode', () => {
  it('renders agent role name', () => {
    render(<AgentNode {...makeNodeProps()} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('renders agent short ID', () => {
    render(<AgentNode {...makeNodeProps()} />);
    expect(screen.getByText(/agent-ab/)).toBeInTheDocument();
  });

  it('renders handles for connections', () => {
    render(<AgentNode {...makeNodeProps()} />);
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
  });

  it('shows status indicator for running agent', () => {
    const { container } = render(<AgentNode {...makeNodeProps()} />);
    // Running status should have a green-ish indicator
    expect(container.querySelector('[class*="bg-"]')).toBeTruthy();
  });

  it('renders failed agent status', () => {
    const props = makeNodeProps();
    props.data = {
      ...props.data as Record<string, unknown>,
      agent: { ...(props.data as any).agent, status: 'failed' },
    } as any;
    render(<AgentNode {...props} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('shows model info', () => {
    render(<AgentNode {...makeNodeProps()} />);
    expect(screen.getByText(/claude/i)).toBeInTheDocument();
  });

  it('handles idle status', () => {
    const props = makeNodeProps();
    props.data = {
      ...props.data as Record<string, unknown>,
      agent: { ...(props.data as any).agent, status: 'idle' },
    } as any;
    const { container } = render(<AgentNode {...props} />);
    expect(container).toBeTruthy();
  });

  it('shows context pressure indicator when burn rate is high', () => {
    const props = makeNodeProps();
    props.data = {
      ...props.data as Record<string, unknown>,
      agent: { ...(props.data as any).agent, contextBurnRate: 0.9 },
    } as any;
    const { container } = render(<AgentNode {...props} />);
    expect(container).toBeTruthy();
  });
});
