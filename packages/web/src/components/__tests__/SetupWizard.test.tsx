import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SetupWizard, shouldShowSetupWizard } from '../SetupWizard';

// ── localStorage polyfill (jsdom may not provide a working one) ─────

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ── Mock apiFetch ───────────────────────────────────────────────────

const mockApiFetch = vi.fn();

vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Test Data ───────────────────────────────────────────────────────

const MOCK_PROVIDERS = [
  { id: 'copilot', name: 'GitHub Copilot SDK', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/gh' },
  { id: 'claude', name: 'Claude Code', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/claude' },
  { id: 'gemini', name: 'Google Gemini CLI', installed: false, authenticated: null, enabled: true, binaryPath: null },
  { id: 'opencode', name: 'OpenCode', installed: false, authenticated: null, enabled: true, binaryPath: null },
  { id: 'cursor', name: 'Cursor', installed: false, authenticated: null, enabled: true, binaryPath: null },
  { id: 'codex', name: 'Codex', installed: false, authenticated: null, enabled: true, binaryPath: null },
];

const ALL_NOT_INSTALLED = MOCK_PROVIDERS.map((p) => ({ ...p, installed: false, binaryPath: null }));

// ── Tests ───────────────────────────────────────────────────────────

describe('SetupWizard', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    mockApiFetch.mockReset();
    onComplete.mockReset();
    storage.clear();
  });

  it('renders welcome step initially', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    expect(screen.getByText(/welcome to flightdeck/i)).toBeInTheDocument();
  });

  it('navigates to providers step on next', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(screen.getByTestId('step-providers')).toBeInTheDocument();
    });

    expect(screen.getByText(/2 of 6 providers detected/i)).toBeInTheDocument();
  });

  it('shows installed status for configured providers', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(screen.getByTestId('provider-copilot')).toBeInTheDocument();
    });

    expect(screen.getByTestId('provider-copilot')).toHaveTextContent('Installed');
    expect(screen.getByTestId('provider-claude')).toHaveTextContent('Installed');
    expect(screen.getByTestId('install-gemini')).toBeInTheDocument();
  });

  it('shows no providers message when none detected', async () => {
    mockApiFetch.mockResolvedValue(ALL_NOT_INSTALLED);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(screen.getByText(/no providers detected/i)).toBeInTheDocument();
    });
  });

  it('navigates through all three steps', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    // Step 1: Welcome
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Step 2: Providers
    await waitFor(() => {
      expect(screen.getByTestId('step-providers')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Step 3: Done
    expect(screen.getByTestId('step-done')).toBeInTheDocument();
    expect(screen.getByText(/you're ready/i)).toBeInTheDocument();
  });

  it('back button navigates to previous step', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => {
      expect(screen.getByTestId('step-providers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
  });

  it('dismiss sets localStorage and calls onComplete', () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('skip sets localStorage and calls onComplete', () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-skip'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('finish on done step sets localStorage and calls onComplete', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    // Navigate to done
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => screen.getByTestId('step-providers'));
    fireEvent.click(screen.getByTestId('wizard-next'));

    fireEvent.click(screen.getByTestId('wizard-finish'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('install link has external href for uninstalled providers', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => screen.getByTestId('install-gemini'));

    const link = screen.getByTestId('install-gemini');
    expect(link).toHaveAttribute('href', 'https://github.com/google-gemini/gemini-cli');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('handles API error gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<SetupWizard onComplete={onComplete} />);

    // Should still render welcome step
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();

    // Navigate to providers — should show empty list, no crash
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => {
      expect(screen.getByTestId('step-providers')).toBeInTheDocument();
    });
  });
});

describe('shouldShowSetupWizard', () => {
  beforeEach(() => storage.clear());

  it('returns true when setup not completed', () => {
    expect(shouldShowSetupWizard()).toBe(true);
  });

  it('returns false when setup completed', () => {
    localStorage.setItem('flightdeck-setup-completed', 'true');
    expect(shouldShowSetupWizard()).toBe(false);
  });
});
