import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  // ── Basic rendering ────────────────────────────────────────

  it('renders title text', () => {
    render(<EmptyState title="No agents found" />);
    expect(screen.getByText('No agents found')).toBeTruthy();
  });

  it('renders description when provided', () => {
    render(
      <EmptyState title="No data" description="Complete a session to see analytics." />,
    );
    expect(screen.getByText('Complete a session to see analytics.')).toBeTruthy();
  });

  it('applies role="status"', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('sets data-testid', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  // ── Icon ───────────────────────────────────────────────────

  it('renders emoji icon as text', () => {
    render(<EmptyState icon="📊" title="No data" />);
    expect(screen.getByText('📊')).toBeTruthy();
  });

  it('renders ReactNode icon', () => {
    render(
      <EmptyState
        icon={<svg data-testid="svg-icon" />}
        title="No agents"
      />,
    );
    expect(screen.getByTestId('svg-icon')).toBeTruthy();
  });

  it('renders without icon', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  // ── Action button ──────────────────────────────────────────

  it('renders action button', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No agents"
        action={{ label: 'Add Agent', onClick }}
      />,
    );
    expect(screen.getByText('Add Agent')).toBeTruthy();
  });

  it('fires onClick when action button is clicked', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Create', onClick }}
      />,
    );
    fireEvent.click(screen.getByText('Create'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('sets data-testid on action button', () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Go', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('empty-state-action')).toBeTruthy();
  });

  // ── Children ───────────────────────────────────────────────

  it('renders children content', () => {
    render(
      <EmptyState title="No results">
        <p>Try adjusting your filters.</p>
      </EmptyState>,
    );
    expect(screen.getByText('Try adjusting your filters.')).toBeTruthy();
  });

  // ── Compact mode ───────────────────────────────────────────

  it('applies compact spacing', () => {
    render(<EmptyState title="Compact" compact />);
    const el = screen.getByTestId('empty-state');
    expect(el.className).toContain('py-8');
    expect(el.className).not.toContain('py-16');
  });

  it('applies full spacing by default', () => {
    render(<EmptyState title="Full" />);
    const el = screen.getByTestId('empty-state');
    expect(el.className).toContain('py-16');
  });

  // ── className passthrough ──────────────────────────────────

  it('appends custom className', () => {
    render(<EmptyState title="Empty" className="my-custom-class" />);
    const el = screen.getByTestId('empty-state');
    expect(el.className).toContain('my-custom-class');
  });
});
