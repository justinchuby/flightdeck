import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpotlightTour, isTourComplete, resetTour } from '../SpotlightTour';

// Mock the useSpotlight hook — return null (center positioning) for simplicity
vi.mock('../../../hooks/useSpotlight', () => ({
  useSpotlight: () => null,
}));

// jsdom localStorage stub
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((_i: number) => null),
};
vi.stubGlobal('localStorage', localStorageMock);

describe('SpotlightTour', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  function renderTour() {
    return render(<SpotlightTour onComplete={onComplete} />);
  }

  it('renders the first step', () => {
    renderTour();
    expect(screen.getByText('The Pulse')).toBeInTheDocument();
    expect(screen.getByText(/Your crew's health at a glance/)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
  });

  it('does not show Back button on first step', () => {
    renderTour();
    expect(screen.queryByText('← Back')).not.toBeInTheDocument();
  });

  it('navigates to the next step when Next is clicked', () => {
    renderTour();
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('Your Agents')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
  });

  it('shows Back button after advancing and navigates back', () => {
    renderTour();
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('← Back')).toBeInTheDocument();

    fireEvent.click(screen.getByText('← Back'));
    expect(screen.getByText('The Pulse')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
  });

  it('shows "Done" on the last step and calls onComplete', () => {
    renderTour();
    // Navigate to last step (6 steps, click next 5 times)
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText(/Next →|Done/));
    }
    expect(screen.getByText("You're Ready! 🎉")).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Done'));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(localStorage.getItem('onboarding-tour-complete')).toBe('true');
  });

  it('calls onComplete and sets localStorage when Skip tour is clicked', () => {
    renderTour();
    fireEvent.click(screen.getByText('Skip tour'));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(localStorage.getItem('onboarding-tour-complete')).toBe('true');
  });

  it('supports keyboard navigation with ArrowRight', () => {
    renderTour();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Your Agents')).toBeInTheDocument();
  });

  it('supports keyboard navigation with ArrowLeft', () => {
    renderTour();
    // Go forward first
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Your Agents')).toBeInTheDocument();
    // Go back
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('The Pulse')).toBeInTheDocument();
  });

  it('supports keyboard Escape to skip', () => {
    renderTour();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('supports keyboard Enter to advance', () => {
    renderTour();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByText('Your Agents')).toBeInTheDocument();
  });

  it('renders the dialog with proper aria attributes', () => {
    renderTour();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('isTourComplete', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns false when tour has not been completed', () => {
    expect(isTourComplete()).toBe(false);
  });

  it('returns true when tour has been completed', () => {
    localStorageMock.setItem('onboarding-tour-complete', 'true');
    expect(isTourComplete()).toBe(true);
  });
});

describe('resetTour', () => {
  it('removes the tour completion flag', () => {
    localStorageMock.setItem('onboarding-tour-complete', 'true');
    resetTour();
    expect(localStorageMock.getItem('onboarding-tour-complete')).toBeNull();
  });
});
