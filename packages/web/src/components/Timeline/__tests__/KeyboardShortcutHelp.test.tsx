import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutHelp } from '../KeyboardShortcutHelp';

describe('KeyboardShortcutHelp', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<KeyboardShortcutHelp isOpen={false} onClose={onClose} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the dialog when isOpen is true', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
  });

  it('shows expected shortcut descriptions', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Navigate between agent lanes')).toBeTruthy();
    expect(screen.getByText('Toggle this help')).toBeTruthy();
  });

  it('does not show removed zoom/pan shortcuts', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    expect(screen.queryByText('Pan timeline left / right')).toBeNull();
    expect(screen.queryByText('Zoom in / out')).toBeNull();
    expect(screen.queryByText('Zoom at cursor')).toBeNull();
  });

  it('calls onClose when Escape is pressed', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when ? is pressed', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: '?' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when inner panel is clicked', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    render(<KeyboardShortcutHelp isOpen={true} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Keyboard shortcuts');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
