import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';

import { AgentTimeline } from '../AgentTimeline';

function makeAgent(id: string, parentId: string | null = null, overrides = {}) {
  return {
    id,
    parentId,
    projectId: 'proj-1',
    status: 'running',
    role: { id: 'developer', name: 'Developer', icon: '💻' },
    ...overrides,
  };
}

describe('AgentTimeline', () => {
  beforeEach(() => {
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      setSelectedAgent: (id: string | null) =>
        useAppStore.setState({ selectedAgentId: id }),
    });
  });

  it('returns null when no agents exist', () => {
    const { container } = render(<AgentTimeline />);
    expect(container.innerHTML).toBe('');
  });

  it('renders root agents in hierarchy', () => {
    useAppStore.setState({
      agents: [
        makeAgent('root-1', null, { role: { id: 'lead', name: 'Lead', icon: '👑' } }),
      ] as any[],
    });
    render(<AgentTimeline />);
    expect(screen.getByText('Agent Hierarchy')).toBeTruthy();
    expect(screen.getByText(/Lead/)).toBeTruthy();
  });

  it('renders child agents nested under parent', () => {
    useAppStore.setState({
      agents: [
        makeAgent('root-1', null, { role: { id: 'lead', name: 'Lead', icon: '👑' } }),
        makeAgent('child-1', 'root-1', { role: { id: 'developer', name: 'Dev', icon: '💻' } }),
      ] as any[],
    });
    render(<AgentTimeline />);
    expect(screen.getByText(/Lead/)).toBeTruthy();
    expect(screen.getByText(/Dev/)).toBeTruthy();
  });

  it('selects agent on click and deselects on second click', () => {
    useAppStore.setState({
      agents: [
        makeAgent('root-1', null, { role: { id: 'lead', name: 'Lead', icon: '👑' } }),
      ] as any[],
    });
    render(<AgentTimeline />);
    const btn = screen.getByText(/Lead/).closest('button')!;

    fireEvent.click(btn);
    expect(useAppStore.getState().selectedAgentId).toBe('root-1');

    fireEvent.click(btn);
    expect(useAppStore.getState().selectedAgentId).toBeNull();
  });
});
