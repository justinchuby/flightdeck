// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FilterBar } from '../FilterBar';
import { EMPTY_FILTERS, type FilterState } from '../kanbanConstants';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

describe('FilterBar', () => {
  it('renders search input', () => {
    render(<FilterBar filters={makeFilters()} onChange={vi.fn()} availableRoles={[]} availablePriorities={[]} availableAgents={[]} />);
    expect(screen.getByLabelText('Search tasks')).toBeDefined();
  });

  it('calls onChange when search text changes', () => {
    const onChange = vi.fn();
    render(<FilterBar filters={makeFilters()} onChange={onChange} availableRoles={[]} availablePriorities={[]} availableAgents={[]} />);
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'fix bug' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'fix bug' }));
  });

  it('renders role chips when multiple roles', () => {
    render(<FilterBar filters={makeFilters()} onChange={vi.fn()} availableRoles={['developer', 'architect']} availablePriorities={[]} availableAgents={[]} />);
    expect(screen.getByTestId('filter-role-developer')).toBeDefined();
    expect(screen.getByTestId('filter-role-architect')).toBeDefined();
  });

  it('toggles role filter on click', () => {
    const onChange = vi.fn();
    render(<FilterBar filters={makeFilters()} onChange={onChange} availableRoles={['developer', 'architect']} availablePriorities={[]} availableAgents={[]} />);
    fireEvent.click(screen.getByTestId('filter-role-developer'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roles: new Set(['developer']) }));
  });

  it('renders priority chips for priorities > 0', () => {
    render(<FilterBar filters={makeFilters()} onChange={vi.fn()} availableRoles={[]} availablePriorities={[0, 1, 2]} availableAgents={[]} />);
    expect(screen.getByTestId('filter-priority-1')).toBeDefined();
    expect(screen.getByTestId('filter-priority-2')).toBeDefined();
  });

  it('shows clear button when filters active', () => {
    const filters = makeFilters({ search: 'test' });
    render(<FilterBar filters={filters} onChange={vi.fn()} availableRoles={[]} availablePriorities={[]} availableAgents={[]} />);
    expect(screen.getByTestId('filter-clear')).toBeDefined();
  });

  it('hides clear button when no filters active', () => {
    render(<FilterBar filters={makeFilters()} onChange={vi.fn()} availableRoles={[]} availablePriorities={[]} availableAgents={[]} />);
    expect(screen.queryByTestId('filter-clear')).toBeNull();
  });

  it('clears all filters on clear click', () => {
    const onChange = vi.fn();
    const filters = makeFilters({ search: 'test' });
    render(<FilterBar filters={filters} onChange={onChange} availableRoles={[]} availablePriorities={[]} availableAgents={[]} />);
    fireEvent.click(screen.getByTestId('filter-clear'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: '' }));
  });
});
