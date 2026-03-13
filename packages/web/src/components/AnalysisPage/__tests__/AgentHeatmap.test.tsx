// @vitest-environment jsdom
/**
 * Unit tests for AgentHeatmap — agent activity timeline visualization.
 *
 * Covers: label format, time axis, responsive layout, empty state, legend.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AgentHeatmap } from '../AgentHeatmap';
import type { HeatmapBucket } from '../AgentHeatmap';
import type { AgentInfo } from '../../../types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-abc123',
    role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '#3B82F6', icon: '💻', builtIn: true },
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    model: 'claude-sonnet-4-5',
    ...overrides,
  } as AgentInfo;
}

const BASE_TIME = 1700000000000;

function makeBuckets(agentId: string, count: number, bucketWidthMs = 120_000): HeatmapBucket[] {
  return Array.from({ length: count }, (_, i) => ({
    agentId,
    time: BASE_TIME + i * bucketWidthMs,
    intensity: (i + 1) / count,
  }));
}

// Stub ResizeObserver for JSDOM
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('AgentHeatmap', () => {
  it('renders empty state when no agents provided', () => {
    render(<AgentHeatmap agents={[]} buckets={[]} />);
    expect(screen.getByText('No agent activity data')).toBeInTheDocument();
  });

  it('shows role name + short id in row labels (not just raw ID)', () => {
    const agent = makeAgent({ id: 'abc12345-6789', role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '', icon: '', builtIn: true } });
    const buckets = makeBuckets('abc12345-6789', 3);
    render(<AgentHeatmap agents={[agent]} buckets={buckets} />);

    const heatmap = screen.getByTestId('agent-heatmap');
    // Label should show "Developer abc12" format (role + 5-char alphanumeric ID)
    expect(heatmap.textContent).toContain('Developer abc12');
    // Should NOT show raw full ID
    expect(heatmap.textContent).not.toContain('abc12345-6789');
  });

  it('renders time axis labels at the top with rotation', () => {
    const agent = makeAgent();
    const buckets = makeBuckets('agent-abc123', 5);
    const { container } = render(<AgentHeatmap agents={[agent]} buckets={buckets} />);

    // Find rotated time labels (they have -rotate-45 class)
    const rotatedLabels = container.querySelectorAll('.-rotate-45');
    expect(rotatedLabels.length).toBeGreaterThan(0);

    // First label should show "+0s"
    expect(rotatedLabels[0].textContent).toBe('+0s');
  });

  it('uses rectangular layout (not forced square)', () => {
    const agents = [
      makeAgent({ id: 'agent-1' }),
      makeAgent({ id: 'agent-2', role: { id: 'architect', name: 'Architect', description: '', systemPrompt: '', color: '', icon: '', builtIn: true } }),
    ];
    const buckets = [
      ...makeBuckets('agent-1', 3),
      ...makeBuckets('agent-2', 3),
    ];
    const { container } = render(<AgentHeatmap agents={agents} buckets={buckets} />);

    // Should have the min-w-max wrapper (allows full-width layout)
    const minWMax = container.querySelector('.min-w-max');
    expect(minWMax).toBeInTheDocument();
  });

  it('includes a legend with activity levels', () => {
    const agent = makeAgent();
    const buckets = makeBuckets('agent-abc123', 2);
    render(<AgentHeatmap agents={[agent]} buckets={buckets} />);

    expect(screen.getByText('Activity:')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Peak')).toBeInTheDocument();
  });

  it('displays cell tooltips with time context', () => {
    const agent = makeAgent();
    const buckets = makeBuckets('agent-abc123', 3);
    const { container } = render(<AgentHeatmap agents={[agent]} buckets={buckets} />);

    // Find cells with title attributes containing time context
    const allTitledCells = container.querySelectorAll('[title]');
    const cellsWithTime = Array.from(allTitledCells).filter(
      el => el.getAttribute('title')?.includes('at +'),
    );
    expect(cellsWithTime.length).toBeGreaterThan(0);
  });

  it('handles agents with no role gracefully', () => {
    const agent = makeAgent({ id: 'no-role-agent', role: undefined as unknown as AgentInfo['role'] });
    const buckets = makeBuckets('no-role-agent', 2);
    render(<AgentHeatmap agents={[agent]} buckets={buckets} />);

    const heatmap = screen.getByTestId('agent-heatmap');
    expect(heatmap.textContent).toContain('Agent no-role-');
  });
});
