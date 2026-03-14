import { describe, it, expect, vi, beforeEach } from 'vitest';
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

/** Phase 1: config (instant) */
const MOCK_CONFIGS = [
  { id: 'copilot', name: 'GitHub Copilot SDK', enabled: true },
  { id: 'claude', name: 'Claude Code', enabled: true },
  { id: 'gemini', name: 'Google Gemini CLI', enabled: true },
  { id: 'opencode', name: 'OpenCode', enabled: true },
  { id: 'cursor', name: 'Cursor', enabled: true },
  { id: 'codex', name: 'Codex', enabled: true },
];

/** Phase 2: status (async CLI detection) */
const MOCK_STATUSES = [
  { id: 'copilot', installed: true, authenticated: true, binaryPath: '/usr/bin/copilot' },
  { id: 'claude', installed: true, authenticated: true, binaryPath: '/usr/bin/claude-agent-acp' },
  { id: 'gemini', installed: false, authenticated: null, binaryPath: null },
  { id: 'opencode', installed: false, authenticated: null, binaryPath: null },
  { id: 'cursor', installed: false, authenticated: null, binaryPath: null },
  { id: 'codex', installed: false, authenticated: null, binaryPath: null },
];

const ALL_NOT_INSTALLED_STATUSES = MOCK_STATUSES.map((s) => ({ ...s, installed: false, binaryPath: null }));

function mockTwoPhase(configs = MOCK_CONFIGS, statuses = MOCK_STATUSES) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url === '/settings/providers') return Promise.resolve(configs);
    if (url === '/settings/providers/status') return Promise.resolve(statuses);
    return Promise.resolve(undefined);
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SetupWizard', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    mockApiFetch.mockReset();
    onComplete.mockReset();
    storage.clear();
  });

  it('renders welcome step initially', async () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    expect(screen.getByText(/welcome to flightdeck/i)).toBeInTheDocument();
  });

  it('navigates to providers step and shows installed count after detection', async () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(screen.getByTestId('step-providers')).toBeInTheDocument();
    });

    // After status loads, should show installed count
    await waitFor(() => {
      expect(screen.getByText(/2 of 6 providers detected/i)).toBeInTheDocument();
    });
  });

  it('shows installed status for configured providers', async () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(screen.getByTestId('provider-copilot')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('provider-copilot')).toHaveTextContent('Installed');
      expect(screen.getByTestId('provider-claude')).toHaveTextContent('Installed');
      expect(screen.getByTestId('provider-gemini')).toHaveTextContent('Not found');
    });
  });

  it('shows no providers message when none detected', async () => {
    mockTwoPhase(MOCK_CONFIGS, ALL_NOT_INSTALLED_STATUSES);
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(screen.getByText(/no providers detected/i)).toBeInTheDocument();
    });
  });

  it('navigates through all three steps', async () => {
    mockTwoPhase();
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
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => {
      expect(screen.getByTestId('step-providers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
  });

  it('dismiss sets localStorage and calls onComplete', () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('skip sets localStorage and calls onComplete', () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-skip'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('finish on done step sets localStorage and calls onComplete', async () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    // Navigate to done
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => screen.getByTestId('step-providers'));
    fireEvent.click(screen.getByTestId('wizard-next'));

    fireEvent.click(screen.getByTestId('wizard-finish'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('shows setup links for providers with multiple links', async () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => screen.getByTestId('provider-claude'));

    // Claude should show ACP adapter link
    const claudeCard = screen.getByTestId('provider-claude');
    expect(claudeCard).toHaveTextContent('ACP adapter');
    expect(claudeCard).toHaveTextContent('Claude Code CLI');
  });

  it('enable/disable toggle calls API and updates UI', async () => {
    mockTwoPhase();
    render(<SetupWizard onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => screen.getByTestId('toggle-copilot'));

    // Toggle copilot off
    fireEvent.click(screen.getByTestId('toggle-copilot'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/settings/providers/copilot',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });
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
