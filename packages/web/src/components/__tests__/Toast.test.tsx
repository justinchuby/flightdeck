// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useToastStore, ToastContainer } from '../Toast';

beforeEach(() => {
  // Reset store between tests
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useToastStore', () => {
  it('starts with empty toasts', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('add() creates a toast with id, type, and message', () => {
    act(() => useToastStore.getState().add('success', 'It worked'));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('It worked');
    expect(toasts[0].id).toMatch(/^toast-/);
  });

  it('add() supports error type', () => {
    act(() => useToastStore.getState().add('error', 'Something broke'));
    expect(useToastStore.getState().toasts[0].type).toBe('error');
  });

  it('add() supports info type', () => {
    act(() => useToastStore.getState().add('info', 'FYI'));
    expect(useToastStore.getState().toasts[0].type).toBe('info');
  });

  it('add() appends multiple toasts', () => {
    act(() => {
      useToastStore.getState().add('success', 'First');
      useToastStore.getState().add('error', 'Second');
    });
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('remove() deletes a toast by id', () => {
    act(() => useToastStore.getState().add('info', 'Will be removed'));
    const id = useToastStore.getState().toasts[0].id;
    act(() => useToastStore.getState().remove(id));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-removes toast after 5 seconds', () => {
    act(() => useToastStore.getState().add('success', 'Ephemeral'));
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-remove only affects the specific toast', () => {
    act(() => {
      useToastStore.getState().add('success', 'First');
    });
    // Advance 2s, then add second toast
    act(() => vi.advanceTimersByTime(2000));
    act(() => {
      useToastStore.getState().add('error', 'Second');
    });
    // Advance 3s — first should be gone (5s total), second still present (3s)
    act(() => vi.advanceTimersByTime(3000));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Second');
  });
});

describe('ToastContainer', () => {
  it('renders nothing when no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders toast messages', () => {
    act(() => useToastStore.getState().add('success', 'Great job'));
    render(<ToastContainer />);
    expect(screen.getByText('Great job')).toBeDefined();
  });

  it('renders icon for success toast', () => {
    act(() => useToastStore.getState().add('success', 'Pass'));
    const { container } = render(<ToastContainer />);
    // Success icon should have green color class
    const icon = container.querySelector('.text-green-600, .dark\\:text-green-300');
    expect(icon).not.toBeNull();
  });

  it('renders icon for error toast', () => {
    act(() => useToastStore.getState().add('error', 'Fail'));
    const { container } = render(<ToastContainer />);
    const icon = container.querySelector('.text-red-600, .dark\\:text-red-300');
    expect(icon).not.toBeNull();
  });

  it('renders icon for info toast', () => {
    act(() => useToastStore.getState().add('info', 'Note'));
    const { container } = render(<ToastContainer />);
    const icon = container.querySelector('.text-blue-600, .dark\\:text-blue-300');
    expect(icon).not.toBeNull();
  });

  it('renders multiple toasts', () => {
    act(() => {
      useToastStore.getState().add('success', 'Toast A');
      useToastStore.getState().add('error', 'Toast B');
    });
    render(<ToastContainer />);
    expect(screen.getByText('Toast A')).toBeDefined();
    expect(screen.getByText('Toast B')).toBeDefined();
  });

  it('dismiss button removes the toast', () => {
    act(() => useToastStore.getState().add('info', 'Dismissable'));
    render(<ToastContainer />);
    // Click the X button (only button in the toast)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('toast disappears from DOM after auto-remove', () => {
    act(() => useToastStore.getState().add('success', 'Vanishing'));
    render(<ToastContainer />);
    expect(screen.getByText('Vanishing')).toBeDefined();
    act(() => vi.advanceTimersByTime(5000));
    // Re-render to reflect store change
    cleanup();
    const { container: after } = render(<ToastContainer />);
    expect(after.innerHTML).toBe('');
  });
});
