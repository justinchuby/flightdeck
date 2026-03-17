// @vitest-environment jsdom
/**
 * Coverage for BatchActionBar — renders with selected projects, handles button clicks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchActionBar } from '../BatchActionBar';

describe('BatchActionBar — coverage', () => {
  it('renders nothing when no projects selected', () => {
    const { container } = render(
      <BatchActionBar
        selectedCount={0}
        allSelectedArchived={false}
        onSelectAll={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders action bar with selected count', () => {
    render(
      <BatchActionBar
        selectedCount={3}
        allSelectedArchived={false}
        onSelectAll={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText('Select all')).toBeInTheDocument();
    expect(screen.getByText('Archive selected')).toBeInTheDocument();
    expect(screen.getByText('Delete selected')).toBeInTheDocument();
  });

  it('calls onSelectAll when Select all is clicked', () => {
    const onSelectAll = vi.fn();
    render(
      <BatchActionBar
        selectedCount={2}
        allSelectedArchived={false}
        onSelectAll={onSelectAll}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Select all'));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('calls onArchive when Archive is clicked', () => {
    const onArchive = vi.fn();
    render(
      <BatchActionBar
        selectedCount={2}
        allSelectedArchived={false}
        onSelectAll={vi.fn()}
        onArchive={onArchive}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Archive selected'));
    expect(onArchive).toHaveBeenCalled();
  });

  it('disables Delete when not all archived', () => {
    render(
      <BatchActionBar
        selectedCount={2}
        allSelectedArchived={false}
        onSelectAll={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    const deleteBtn = screen.getByText('Delete selected');
    expect(deleteBtn).toBeDisabled();
  });

  it('enables Delete when all selected are archived', () => {
    const onDelete = vi.fn();
    render(
      <BatchActionBar
        selectedCount={2}
        allSelectedArchived={true}
        onSelectAll={vi.fn()}
        onArchive={vi.fn()}
        onDelete={onDelete}
        onClear={vi.fn()}
      />,
    );
    const deleteBtn = screen.getByText('Delete selected');
    expect(deleteBtn).not.toBeDisabled();
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalled();
  });

  it('calls onClear when clear button is clicked', () => {
    const onClear = vi.fn();
    render(
      <BatchActionBar
        selectedCount={1}
        allSelectedArchived={false}
        onSelectAll={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByText('✕'));
    expect(onClear).toHaveBeenCalled();
  });
});
