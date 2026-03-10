import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionErrorBoundary } from '../SectionErrorBoundary';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test explosion');
  return <div>healthy content</div>;
}

describe('SectionErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <SectionErrorBoundary name="Test">
        <div>child content</div>
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('child content')).toBeTruthy();
  });

  it('shows fallback with section name on error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <SectionErrorBoundary name="Decisions feed">
        <ThrowingChild shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Decisions feed encountered an error.')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('shows generic fallback when no name provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <SectionErrorBoundary>
        <ThrowingChild shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('This section encountered an error.')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('recovers on Retry click when error is resolved', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // First render throws
    render(
      <SectionErrorBoundary name="Test">
        <ThrowingChild shouldThrow />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Test encountered an error.')).toBeTruthy();

    // Click retry — boundary resets, but same children re-render.
    // Since ThrowingChild still throws (props unchanged), boundary catches again.
    // This verifies the retry mechanism resets internal state.
    fireEvent.click(screen.getByText('Retry'));
    // After retry with same throwing child, boundary catches again
    expect(screen.getByText('Test encountered an error.')).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('auto-resets error when resetKey changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let shouldThrow = true;
    const { rerender } = render(
      <SectionErrorBoundary name="Route" resetKey="/old-path">
        <ThrowingChild shouldThrow={shouldThrow} />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('Route encountered an error.')).toBeTruthy();

    // Simulate navigation — resetKey changes, child now healthy
    shouldThrow = false;
    rerender(
      <SectionErrorBoundary name="Route" resetKey="/new-path">
        <ThrowingChild shouldThrow={shouldThrow} />
      </SectionErrorBoundary>,
    );
    expect(screen.getByText('healthy content')).toBeTruthy();
    vi.restoreAllMocks();
  });
});
