import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterFilterBar } from '../RosterFilterBar';

function renderBar(overrides = {}) {
  const props = {
    crewCount: 3,
    agentCount: 12,
    search: '',
    onSearchChange: vi.fn(),
    statusFilter: 'all' as const,
    onStatusFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<RosterFilterBar {...props} />);
  return props;
}

describe('RosterFilterBar', () => {
  it('renders crew and agent counts', () => {
    renderBar({ crewCount: 2, agentCount: 7 });
    expect(screen.getByText('2 crews · 7 agents')).toBeTruthy();
  });

  it('singularizes crew/agent when count is 1', () => {
    renderBar({ crewCount: 1, agentCount: 1 });
    expect(screen.getByText('1 crew · 1 agent')).toBeTruthy();
  });

  it('calls onSearchChange when typing', () => {
    const props = renderBar();
    const input = screen.getByPlaceholderText('Search crews, agents, tasks...');
    fireEvent.change(input, { target: { value: 'dev' } });
    expect(props.onSearchChange).toHaveBeenCalledWith('dev');
  });

  it('calls onRefresh when Refresh button clicked', () => {
    const props = renderBar();
    fireEvent.click(screen.getByText('Refresh'));
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it('renders all filter buttons', () => {
    renderBar();
    expect(screen.getByText('all')).toBeTruthy();
    expect(screen.getByText('idle')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('terminated')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('calls onStatusFilterChange when a filter button is clicked', () => {
    const props = renderBar();
    fireEvent.click(screen.getByText('running'));
    expect(props.onStatusFilterChange).toHaveBeenCalledWith('running');
  });
});
