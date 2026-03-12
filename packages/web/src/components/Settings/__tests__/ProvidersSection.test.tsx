// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProvidersSection } from '../ProvidersSection';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────

const MOCK_PROVIDERS = [
  {
    id: 'copilot',
    name: 'GitHub Copilot SDK',
    installed: true,
    authenticated: true,
    enabled: true,
    binaryPath: '/usr/bin/copilot',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    installed: true,
    authenticated: true,
    enabled: true,
    binaryPath: '/usr/bin/claude',
  },
  {
    id: 'gemini',
    name: 'Google Gemini CLI',
    installed: false,
    authenticated: null,
    enabled: true,
    binaryPath: null,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    installed: false,
    authenticated: null,
    enabled: true,
    binaryPath: null,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    installed: false,
    authenticated: null,
    enabled: false,
    binaryPath: null,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    installed: true,
    authenticated: false,
    enabled: true,
    binaryPath: '/usr/bin/codex',
  },
];

const MOCK_RANKING = {
  ranking: ['copilot', 'claude', 'gemini', 'opencode', 'cursor', 'codex'],
};

/** Mock both /settings/providers and /settings/provider-ranking API calls. */
function mockProviderApis() {
  mockApiFetch
    .mockResolvedValueOnce(MOCK_PROVIDERS)
    .mockResolvedValueOnce(MOCK_RANKING);
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

  it('renders all 6 provider cards after loading', async () => {
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

  it('shows installed count', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByText('3/6 installed')).toBeInTheDocument();
    });
  });

  it('shows "Ready" badge for installed+authenticated providers', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    // Copilot and Claude are installed+authenticated → "Ready"
    const readyBadges = screen.getAllByText('Ready');
    expect(readyBadges.length).toBe(2);
  });

  it('shows "Not installed" for missing providers', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const notInstalled = screen.getAllByText('Not installed');
    expect(notInstalled.length).toBe(3); // gemini, opencode, cursor
  });

  it('shows "Not authenticated" for installed but unauthed providers', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    expect(screen.getByText('Not authenticated')).toBeInTheDocument(); // codex
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
    mockApiFetch.mockResolvedValueOnce({ ...MOCK_PROVIDERS[0], enabled: false });
    fireEvent.click(screen.getByTestId('toggle-copilot'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/settings/providers/copilot',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('expands a card and shows test connection button', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    // Expand Claude card
    const claudeCard = screen.getByTestId('provider-card-claude');
    fireEvent.click(claudeCard.querySelector('[role="button"]')!);
    expect(screen.getByTestId('test-connection-claude')).toBeInTheDocument();
  });

  it('shows test connection result on click', async () => {
    mockProviderApis();
    // Third call: test connection response
    mockApiFetch.mockResolvedValueOnce({ success: true, message: 'Provider is installed and responsive' });

    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });

    // Expand and test
    const claudeCard = screen.getByTestId('provider-card-claude');
    fireEvent.click(claudeCard.querySelector('[role="button"]')!);
    fireEvent.click(screen.getByTestId('test-connection-claude'));

    await waitFor(() => {
      expect(screen.getByTestId('test-result-claude')).toBeInTheDocument();
    });
    expect(screen.getByText(/installed and responsive/)).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
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

  it('shows preview badge for Claude but not Copilot or Codex', async () => {
    mockProviderApis();
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const copilotCard = screen.getByTestId('provider-card-copilot');
    const claudeCard = screen.getByTestId('provider-card-claude');
    const codexCard = screen.getByTestId('provider-card-codex');
    expect(copilotCard.querySelector('[data-testid="preview-badge"]')).toBeNull();
    expect(claudeCard.querySelector('[data-testid="preview-badge"]')).not.toBeNull();
    expect(codexCard.querySelector('[data-testid="preview-badge"]')).toBeNull();
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
