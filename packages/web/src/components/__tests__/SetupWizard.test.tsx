import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  { id: 'kimi', name: 'Kimi', enabled: true },
  { id: 'qwen-code', name: 'Qwen Code', enabled: true },
];

/** Phase 2: status (async CLI detection) */
const MOCK_STATUSES = [
  { id: 'copilot', installed: true, authenticated: true, binaryPath: '/usr/bin/copilot' },
  { id: 'claude', installed: true, authenticated: true, binaryPath: '/usr/bin/claude-agent-acp' },
  { id: 'gemini', installed: false, authenticated: null, binaryPath: null },
  { id: 'opencode', installed: false, authenticated: null, binaryPath: null },
  { id: 'cursor', installed: false, authenticated: null, binaryPath: null },
  { id: 'codex', installed: false, authenticated: null, binaryPath: null },
  { id: 'kimi', installed: false, authenticated: null, binaryPath: null },
  { id: 'qwen-code', installed: false, authenticated: null, binaryPath: null },
];

const ALL_NOT_INSTALLED_STATUSES = MOCK_STATUSES.map((s) => ({ ...s, installed: false, binaryPath: null }));
const MOCK_RANKING = { ranking: MOCK_CONFIGS.map(({ id }) => id) };

function mockWizardApis({
  configs = MOCK_CONFIGS,
  statuses = MOCK_STATUSES,
  ranking = MOCK_RANKING,
  rankingError,
}: {
  configs?: typeof MOCK_CONFIGS;
  statuses?: typeof MOCK_STATUSES;
  ranking?: { ranking: string[] };
  rankingError?: Error;
} = {}) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url === '/settings/providers') return Promise.resolve(configs);
    if (url === '/settings/provider-ranking') {
      return rankingError ? Promise.reject(rankingError) : Promise.resolve(ranking);
    }
    if (url === '/settings/providers/status') return Promise.resolve(statuses);
    return Promise.resolve(undefined);
  });
}

async function goToProvidersStep() {
  fireEvent.click(screen.getByTestId('wizard-next'));
  await waitFor(() => {
    expect(screen.getByTestId('step-providers')).toBeInTheDocument();
  });
}

async function goToPreferencesStep() {
  await goToProvidersStep();
  fireEvent.click(screen.getByTestId('wizard-next'));
  await waitFor(() => {
    expect(screen.getByTestId('step-preferences')).toBeInTheDocument();
  });
}

async function goToDoneStep() {
  await goToPreferencesStep();
  fireEvent.click(screen.getByTestId('wizard-next'));
  await waitFor(() => {
    expect(screen.getByTestId('step-done')).toBeInTheDocument();
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
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    expect(screen.getByText(/welcome to flightdeck/i)).toBeInTheDocument();
  });

  it('navigates to providers step and shows installed count after detection', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();

    // After status loads, should show installed count
    await waitFor(() => {
      expect(screen.getByText(/2 of 8 providers detected/i)).toBeInTheDocument();
    });
  });

  it('shows installed status for configured providers', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();
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
    mockWizardApis({ configs: MOCK_CONFIGS, statuses: ALL_NOT_INSTALLED_STATUSES });
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();
    await waitFor(() => {
      expect(screen.getByText(/no providers detected/i)).toBeInTheDocument();
    });
  });

  it('keeps provider setup usable when ranking fetch fails', async () => {
    mockWizardApis({ rankingError: new Error('ranking unavailable') });
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();

    await waitFor(() => {
      expect(screen.getByText(/2 of 8 providers detected/i)).toBeInTheDocument();
    });

    const providerRows = screen.getAllByTestId(/provider-/);
    expect(providerRows[0]).toHaveAttribute('data-testid', 'provider-copilot');
    expect(providerRows[1]).toHaveAttribute('data-testid', 'provider-claude');
  });

  it('navigates through welcome, providers, preferences, and done steps', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    await goToProvidersStep();
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => {
      expect(screen.getByTestId('step-preferences')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => {
      expect(screen.getByTestId('step-done')).toBeInTheDocument();
    });

    expect(screen.getByTestId('step-done')).toBeInTheDocument();
    expect(screen.getByText(/you're ready/i)).toBeInTheDocument();
  });

  it('back button navigates to previous step', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();

    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
  });

  it('dismiss sets localStorage and calls onComplete', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('skip sets localStorage and calls onComplete', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    fireEvent.click(screen.getByTestId('wizard-skip'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('finish on done step sets localStorage and calls onComplete', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToDoneStep();

    fireEvent.click(screen.getByTestId('wizard-finish'));
    expect(localStorage.getItem('flightdeck-setup-completed')).toBe('true');
    expect(onComplete).toHaveBeenCalled();
  });

  it('applies selected preferences before continuing to done', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToPreferencesStep();

    fireEvent.click(screen.getByTestId('user-type-team'));
    fireEvent.click(screen.getByTestId('oversight-balanced'));
    fireEvent.click(screen.getByTestId('wizard-next'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/config',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ maxConcurrentAgents: 50, oversightLevel: 'balanced' }),
        }),
      );
    });
    expect(screen.getByTestId('step-done')).toBeInTheDocument();
  });

  it('shows setup links for providers with multiple links', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();
    await waitFor(() => screen.getByTestId('provider-claude'));

    // Claude should show ACP adapter link
    const claudeCard = screen.getByTestId('provider-claude');
    expect(claudeCard).toHaveTextContent('ACP adapter');
    expect(claudeCard).toHaveTextContent('Claude Code CLI');
  });

  it('enable/disable toggle calls API and updates UI', async () => {
    mockWizardApis();
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

    await goToProvidersStep();
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
    await act(async () => { render(<SetupWizard onComplete={onComplete} />); });

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

  it('returns true when setup not completed', async () => {
    expect(shouldShowSetupWizard()).toBe(true);
  });

  it('returns false when setup completed', async () => {
    localStorage.setItem('flightdeck-setup-completed', 'true');
    expect(shouldShowSetupWizard()).toBe(false);
  });
});
