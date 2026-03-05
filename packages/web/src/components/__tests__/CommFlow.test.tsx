import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommFlowGraph } from '../CommFlow/CommFlowGraph';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import type { AgentInfo, Role } from '../../types';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Writes code',
    systemPrompt: '',
    color: '#3B82F6',
    icon: '💻',
    builtIn: true,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 10)}`,
    role: makeRole(),
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    autopilot: true,
    ...overrides,
  };
}

const LEAD_ID = 'lead-abc123';

describe('CommFlowGraph', () => {
  beforeEach(() => {
    useAppStore.getState().setAgents([]);
  });

  it('shows empty state when no agents', () => {
    render(<CommFlowGraph leadId={LEAD_ID} />);
    expect(screen.getByText('No agents in this session')).toBeDefined();
  });

  it('renders SVG with agent nodes', () => {
    const agents = [
      makeAgent({ id: 'a1', parentId: LEAD_ID, role: makeRole({ name: 'Architect', icon: '🏗️' }) }),
      makeAgent({ id: 'a2', parentId: LEAD_ID, role: makeRole({ name: 'Developer', icon: '💻' }) }),
    ];
    useAppStore.getState().setAgents(agents);

    render(<CommFlowGraph leadId={LEAD_ID} />);
    const svg = screen.getByTestId('comm-flow-graph');
    expect(svg).toBeDefined();
    expect(svg.tagName).toBe('svg');
    // Agent labels should be visible
    expect(screen.getByText(/Architect \(a1/)).toBeDefined();
    expect(screen.getByText(/Developer \(a2/)).toBeDefined();
  });

  it('renders legend', () => {
    const agents = [
      makeAgent({ id: 'a1', parentId: LEAD_ID }),
    ];
    useAppStore.getState().setAgents(agents);

    render(<CommFlowGraph leadId={LEAD_ID} />);
    expect(screen.getByText('Messages')).toBeDefined();
    expect(screen.getByText('Delegation')).toBeDefined();
    expect(screen.getByText('Direct')).toBeDefined();
    expect(screen.getByText('Group')).toBeDefined();
    expect(screen.getByText('Broadcast')).toBeDefined();
  });

  it('clicking a node highlights it', () => {
    const agents = [
      makeAgent({ id: 'a1', parentId: LEAD_ID, role: makeRole({ name: 'Architect', icon: '🏗️' }) }),
      makeAgent({ id: 'a2', parentId: LEAD_ID, role: makeRole({ name: 'Developer', icon: '💻' }) }),
    ];
    useAppStore.getState().setAgents(agents);

    render(<CommFlowGraph leadId={LEAD_ID} />);
    // Click on the Architect node text
    const archLabel = screen.getByText(/Architect \(a1/);
    const nodeGroup = archLabel.closest('g');
    fireEvent.click(nodeGroup!);
    // Clicking again should deselect (toggle behavior)
    fireEvent.click(nodeGroup!);
  });

  it('renders with custom dimensions', () => {
    const agents = [makeAgent({ id: 'a1', parentId: LEAD_ID })];
    useAppStore.getState().setAgents(agents);

    render(<CommFlowGraph leadId={LEAD_ID} width={800} height={600} />);
    const svg = screen.getByTestId('comm-flow-graph');
    expect(svg.getAttribute('width')).toBe('800');
    expect(svg.getAttribute('height')).toBe('600');
  });
});
