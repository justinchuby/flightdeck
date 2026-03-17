import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingWizard, useOnboarding } from '../OnboardingWizard';
import { renderHook } from '@testing-library/react';

// ── localStorage mock ───────────────────────────────────────────────
const storage = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => storage.set(key, val)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
  get length() { return storage.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal('localStorage', mockLocalStorage);

describe('OnboardingWizard', () => {
  let onComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    onComplete = vi.fn();
  });

  it('renders the first step on mount', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByText('Welcome to Flightdeck!')).toBeInTheDocument();
    expect(screen.getByText('1 / 8')).toBeInTheDocument();
  });

  it('navigates forward with Next button', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('The Dashboard')).toBeInTheDocument();
    expect(screen.getByText('2 / 8')).toBeInTheDocument();
  });

  it('navigates backward with Previous button', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('The Dashboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('← Previous'));
    expect(screen.getByText('Welcome to Flightdeck!')).toBeInTheDocument();
  });

  it('disables Previous on first step', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const prevBtn = screen.getByText('← Previous');
    expect(prevBtn).toBeDisabled();
  });

  it('shows "Get Started" on the last step and completes', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    // Navigate to last step (8 steps, click Next 7 times)
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByText(i < 6 ? 'Next →' : 'Next →'));
    }
    expect(screen.getByText('8 / 8')).toBeInTheDocument();
    expect(screen.getByText("You're Ready!")).toBeInTheDocument();

    fireEvent.click(screen.getByText('Get Started'));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('onboarding-complete', 'true');
  });

  it('skips via X button and calls onComplete', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Skip onboarding'));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('onboarding-complete', 'true');
  });

  it('allows clicking progress dots to jump to a step', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    // Click the 3rd dot (index 2 → step 3)
    fireEvent.click(screen.getByLabelText('Go to step 3'));
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByText('3 / 8')).toBeInTheDocument();
  });

  it('shows action hint on the Keyboard Shortcuts step', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    // Navigate to step 6 (Keyboard Shortcuts)
    fireEvent.click(screen.getByLabelText('Go to step 6'));
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Try it now!')).toBeInTheDocument();
  });

  it('renders 8 progress dots', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByLabelText(`Go to step ${i}`)).toBeInTheDocument();
    }
  });
});

describe('useOnboarding', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it('returns shouldShow true when onboarding not complete', () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShow).toBe(true);
  });

  it('returns shouldShow false when onboarding is complete', () => {
    storage.set('onboarding-complete', 'true');
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShow).toBe(false);
  });
});
