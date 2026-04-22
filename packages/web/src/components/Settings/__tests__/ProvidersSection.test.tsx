// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ProvidersSection } from '../ProvidersSection';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────

/** Phase 1: instant config (no CLI calls). */
const MOCK_CONFIGS = [
  { id: 'copilot', name: 'GitHub Copilot SDK', enabled: true },
  { id: 'claude', name: 'Claude Code', enabled: true },
  { id: 'gemini', name: 'Google Gemini CLI', enabled: true },
  { id: 'opencode', name: 'OpenCode', enabled: true },
  { id: 'cursor', name: 'Cursor', enabled: false },
  { id: 'codex', name: 'Codex CLI', enabled: true },
  { id: 'kimi', name: 'Kimi CLI', enabled: true },
  { id: 'qwen-code', name: 'Qwen Code', enabled: true },
];

/** Phase 2: async CLI detection results. */
const MOCK_STATUSES = [
  { id: 'copilot', installed: true, authenticated: true, binaryPath: '/usr/bin/copilot', version: '1.0.0' },
  { id: 'claude', installed: true, authenticated: true, binaryPath: '/usr/bin/claude', version: '2.1.0' },
  { id: 'gemini', installed: false, authenticated: null, binaryPath: null, version: null },
  { id: 'opencode', installed: false, authenticated: null, binaryPath: null, version: null },
  { id: 'cursor', installed: false, authenticated: null, binaryPath: null, version: null },
  { id: 'codex', installed: true, authenticated: false, binaryPath: '/usr/bin/codex', version: '0.5.0' },
  { id: 'kimi', installed: true, authenticated: true, binaryPath: '/usr/bin/kimi', version: '1.24.0' },
  { id: 'qwen-code', installed: true, authenticated: true, binaryPath: '/usr/bin/qwen', version: '0.12.6' },
];

const MOCK_RANKING = {
  ranking: ['copilot', 'claude', 'gemini', 'opencode', 'cursor', 'codex', 'kimi', 'qwen-code'],
};
const MOCK_ACTIVE_PROVIDER = { activeProvider: 'copilot' };

/**
 * Mock the startup loading: configs + ranking + active provider, then statuses.
 */
function mockProviderApis() {
  mockApiFetch
    .mockResolvedValueOnce(MOCK_CONFIGS)
    .mockResolvedValueOnce(MOCK_RANKING)
    .mockResolvedValueOnce(MOCK_ACTIVE_PROVIDER)
    .mockResolvedValueOnce(MOCK_STATUSES);
}

/**
 * Mock Phase 1 only — status never resolves. For skeleton/loading tests.
 */
function mockProviderApisConfigOnly() {
  mockApiFetch
    .mockResolvedValueOnce(MOCK_CONFIGS)
    .mockResolvedValueOnce(MOCK_RANKING)
    .mockResolvedValueOnce(MOCK_ACTIVE_PROVIDER)
    .mockReturnValueOnce(new Promise(() => {})); // status never resolves
}

// ── Tests ─────────────────────────────────────────────────

describe('ProvidersSection', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('renders loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ProvidersSection />);
    expect(screen.getByText('Loading providers…')).toBeInTheDocument();
  });

  it('renders all 8 provider cards after config loads', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    expect(screen.getByText('GitHub Copilot SDK')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Google Gemini CLI')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
  });

  it('shows skeleton badges while status is loading', async () => {
    mockProviderApisConfigOnly();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    // All 8 cards should have skeleton badges
    const skeletons = screen.getAllByTestId('status-badge-skeleton');
    expect(skeletons.length).toBe(8);
  });

  it('shows "N providers" count while status loads, then "X/N installed"', async () => {
    mockProviderApisConfigOnly();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('installed-count')).toHaveTextContent('8 providers');
    });
  });

  it('shows installed count after status loads', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByText('5/8 installed')).toBeInTheDocument();
    });
  });

  it('shows the active badge for the fetched active provider', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('active-badge-copilot')).toBeInTheDocument();
    });
  });

  it('shows "Ready" badge for installed+authenticated providers', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      const readyBadges = screen.getAllByText('Ready');
      expect(readyBadges.length).toBe(4); // Copilot, Claude, Kimi, Qwen Code
    });
  });

  it('shows "Not installed" for missing providers', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      const notInstalled = screen.getAllByText('Not installed');
      expect(notInstalled.length).toBe(3); // gemini, opencode, cursor
    });
  });

  it('shows "Not authenticated" for installed but unauthed providers', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByText('Not authenticated')).toBeInTheDocument(); // codex
    });
  });

  it('has enable/disable toggles for each provider', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('toggle-copilot')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-cursor')).toBeInTheDocument();
  });

  it('calls API when toggling a provider', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    mockApiFetch.mockResolvedValueOnce({ ...MOCK_CONFIGS[0], enabled: false });
    fireEvent.click(screen.getByTestId('toggle-copilot'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/settings/providers/copilot',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('calls API when setting a provider active', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });

    const claudeCard = screen.getByTestId('provider-card-claude');
    fireEvent.click(claudeCard.querySelector('[role="button"]')!);
    mockApiFetch.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByTestId('set-active-claude'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/settings/provider',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ id: 'claude' }),
        }),
      );
    });
  });

  it('expands a card and shows test connection button', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    // Wait for status to load so installed = true and test button appears
    await waitFor(() => {
      expect(screen.getAllByText('Ready').length).toBe(4);
    });
    // Expand Claude card
    const claudeCard = screen.getByTestId('provider-card-claude');
    fireEvent.click(claudeCard.querySelector('[role="button"]')!);
    expect(screen.getByTestId('test-connection-claude')).toBeInTheDocument();
  });

  it('shows test connection result on click', async () => {
    mockProviderApis();

    render(<ProvidersSection />);
    // Wait for status to load
    await waitFor(() => {
      expect(screen.getAllByText('Ready').length).toBe(4);
    });

    // Queue the test connection response
    mockApiFetch.mockResolvedValueOnce({ success: true, message: 'Provider is installed and responsive' });

    // Expand and test
    const claudeCard = screen.getByTestId('provider-card-claude');
    fireEvent.click(claudeCard.querySelector('[role="button"]')!);
    fireEvent.click(screen.getByTestId('test-connection-claude'));

    await waitFor(() => {
      expect(screen.getByTestId('test-result-claude')).toBeInTheDocument();
    });
    expect(screen.getByText(/installed and responsive/)).toBeInTheDocument();
  });

  it('shows error state when config fetch fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it('still renders cards when status fetch fails (non-critical)', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_CONFIGS)
      .mockResolvedValueOnce(MOCK_RANKING)
      .mockResolvedValueOnce(MOCK_ACTIVE_PROVIDER)
      .mockRejectedValueOnce(new Error('status timeout'));
    // Suppress expected warning from ProvidersSection error path
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => { render(<ProvidersSection />); });
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    // Cards render — toggles work even without status
    expect(screen.getByText('GitHub Copilot SDK')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-copilot')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('does not show preview badge for Codex', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const codexCard = screen.getByTestId('provider-card-codex');
    expect(codexCard.querySelector('[data-testid="preview-badge"]')).toBeNull();
  });

  it('shows preview badge for Cursor but not Copilot, Claude, or Codex', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const copilotCard = screen.getByTestId('provider-card-copilot');
    const claudeCard = screen.getByTestId('provider-card-claude');
    const codexCard = screen.getByTestId('provider-card-codex');
    const cursorCard = screen.getByTestId('provider-card-cursor');
    expect(copilotCard.querySelector('[data-testid="preview-badge"]')).toBeNull();
    expect(claudeCard.querySelector('[data-testid="preview-badge"]')).toBeNull();
    expect(codexCard.querySelector('[data-testid="preview-badge"]')).toBeNull();
    expect(cursorCard.querySelector('[data-testid="preview-badge"]')).not.toBeNull();
  });

  it('shows two setup links for Codex when expanded', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const codexCard = screen.getByTestId('provider-card-codex');
    fireEvent.click(codexCard.querySelector('[role="button"]')!);
    const linksContainer = screen.getByTestId('provider-links-codex');
    const links = linksContainer.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('ACP adapter');
    expect(links[0]).toHaveAttribute('href', 'https://github.com/zed-industries/codex-acp');
    expect(links[1]).toHaveTextContent('CLI quickstart');
    expect(links[1]).toHaveAttribute('href', 'https://developers.openai.com/codex/quickstart/?setup=cli');
  });

  it('does not render API key fields anywhere in the DOM', async () => {
    mockProviderApis();
    const { container } = render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const html = container.innerHTML;
    expect(html).not.toContain('maskedKey');
    expect(html).not.toContain('apiKey');
    expect(html).not.toContain('requiredEnvVars');
  });
});
