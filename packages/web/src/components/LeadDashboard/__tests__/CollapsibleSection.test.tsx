// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '../CollapsibleSection';

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function renderSection(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return render(
    <CollapsibleSection
      title="Test Section"
      icon={<span data-testid="section-icon">🔧</span>}
      {...props}
    >
      <div data-testid="child-content">Hello</div>
    </CollapsibleSection>,
  );
}

describe('CollapsibleSection', () => {
  it('renders title and icon', () => {
    renderSection();
    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByTestId('section-icon')).toBeInTheDocument();
  });

  it('renders badge when provided', () => {
    renderSection({ badge: 5 });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not render badge when not provided', () => {
    const { container } = renderSection();
    // No badge element should exist
    expect(container.querySelector('.ml-auto')).toBeNull();
  });

  it('starts expanded with children visible', () => {
    renderSection();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('collapses on click hiding children', () => {
    renderSection();
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('re-expands on second click', () => {
    renderSection();
    const button = screen.getByRole('button');
    fireEvent.click(button); // collapse
    fireEvent.click(button); // expand
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders resize handle when expanded', () => {
    const { container } = renderSection();
    const handle = container.querySelector('.cursor-row-resize');
    expect(handle).toBeInTheDocument();
  });

  it('hides resize handle when collapsed', () => {
    const { container } = renderSection();
    fireEvent.click(screen.getByRole('button'));
    const handle = container.querySelector('.cursor-row-resize');
    expect(handle).not.toBeInTheDocument();
  });
});
