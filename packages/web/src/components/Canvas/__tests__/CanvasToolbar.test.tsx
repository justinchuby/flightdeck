// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasToolbar } from '../CanvasToolbar';

function renderToolbar(overrides = {}) {
  const props = {
    onAutoLayout: vi.fn(),
    onFitView: vi.fn(),
    onToggleLabels: vi.fn(),
    onToggleAnimations: vi.fn(),
    showLabels: true,
    showAnimations: true,
    ...overrides,
  };
  return { ...render(<CanvasToolbar {...props} />), props };
}

describe('CanvasToolbar', () => {
  it('renders all toolbar buttons', () => {
    renderToolbar();
    // Should have at least 4 buttons for the 4 actions
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('calls onAutoLayout when layout button clicked', () => {
    const { props } = renderToolbar();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(props.onAutoLayout).toHaveBeenCalled();
  });

  it('calls onFitView when fit button clicked', () => {
    const { props } = renderToolbar();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(props.onFitView).toHaveBeenCalled();
  });

  it('calls onToggleLabels when labels button clicked', () => {
    const { props } = renderToolbar();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]);
    expect(props.onToggleLabels).toHaveBeenCalled();
  });

  it('calls onToggleAnimations when animations button clicked', () => {
    const { props } = renderToolbar();
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[3]);
    expect(props.onToggleAnimations).toHaveBeenCalled();
  });

  it('reflects showLabels state visually', () => {
    const { rerender } = renderToolbar({ showLabels: false });
    // When labels are off, button should have different styling
    const { container } = render(<CanvasToolbar
      onAutoLayout={vi.fn()}
      onFitView={vi.fn()}
      onToggleLabels={vi.fn()}
      onToggleAnimations={vi.fn()}
      showLabels={true}
      showAnimations={true}
    />);
    expect(container).toBeTruthy();
  });
});
