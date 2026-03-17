// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectFilters } from '../ProjectFilters';

function makeProps(overrides: Partial<Parameters<typeof ProjectFilters>[0]> = {}) {
  return {
    totalProjects: 5,
    totalAgents: 12,
    activeProjects: 3,
    filter: 'all' as const,
    onFilterChange: vi.fn(),
    activeCt: 3,
    archivedCt: 2,
    loading: false,
    onNewProject: vi.fn(),
    onImport: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

describe('ProjectFilters', () => {
  it('renders the header with project count', () => {
    render(<ProjectFilters {...makeProps()} />);
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('5 projects')).toBeInTheDocument();
  });

  it('renders summary cards with correct values', () => {
    render(<ProjectFilters {...makeProps({ totalProjects: 10, totalAgents: 7, activeProjects: 4 })} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('singular "project" when totalProjects is 1', () => {
    render(<ProjectFilters {...makeProps({ totalProjects: 1 })} />);
    expect(screen.getByText('1 project')).toBeInTheDocument();
  });

  it('calls onNewProject when New Project button is clicked', () => {
    const onNewProject = vi.fn();
    render(<ProjectFilters {...makeProps({ onNewProject })} />);
    fireEvent.click(screen.getByTestId('new-project-btn'));
    expect(onNewProject).toHaveBeenCalledOnce();
  });

  it('calls onImport when Import button is clicked', () => {
    const onImport = vi.fn();
    render(<ProjectFilters {...makeProps({ onImport })} />);
    fireEvent.click(screen.getByTestId('import-project-btn'));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it('calls onRefresh when Refresh button is clicked', () => {
    const onRefresh = vi.fn();
    render(<ProjectFilters {...makeProps({ onRefresh })} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('disables refresh button when loading', () => {
    render(<ProjectFilters {...makeProps({ loading: true })} />);
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('renders filter tabs with counts', () => {
    render(<ProjectFilters {...makeProps({ activeCt: 3, archivedCt: 2 })} />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('calls onFilterChange when a filter tab is clicked', () => {
    const onFilterChange = vi.fn();
    render(<ProjectFilters {...makeProps({ onFilterChange })} />);
    fireEvent.click(screen.getByText('Active'));
    expect(onFilterChange).toHaveBeenCalledWith('active');
    fireEvent.click(screen.getByText('Archived'));
    expect(onFilterChange).toHaveBeenCalledWith('archived');
  });
});
