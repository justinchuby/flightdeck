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
    name: 'GitHub Copilot',
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
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    expect(screen.getByText('GitHub Copilot')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Google Gemini CLI')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('Cursor')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
  });

  it('shows installed count', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByText('3/6 installed')).toBeInTheDocument();
    });
  });

  it('shows "Ready" badge for installed+authenticated providers', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    // Copilot and Claude are installed+authenticated → "Ready"
    const readyBadges = screen.getAllByText('Ready');
    expect(readyBadges.length).toBe(2);
  });

  it('shows "Not installed" for missing providers', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const notInstalled = screen.getAllByText('Not installed');
    expect(notInstalled.length).toBe(3); // gemini, opencode, cursor
  });

  it('shows "Not authenticated" for installed but unauthed providers', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    expect(screen.getByText('Not authenticated')).toBeInTheDocument(); // codex
  });

  it('has enable/disable toggles for each provider', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('toggle-copilot')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-cursor')).toBeInTheDocument();
  });

  it('calls API when toggling a provider', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    mockApiFetch.mockResolvedValue({ ...MOCK_PROVIDERS[0], enabled: false });
    fireEvent.click(screen.getByTestId('toggle-copilot'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/settings/providers/copilot',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('expands a card and shows test connection button', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
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
    mockApiFetch
      .mockResolvedValueOnce(MOCK_PROVIDERS)
      .mockResolvedValueOnce({ success: true, message: 'Provider is installed and responsive' });

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

  it('does not render API key fields anywhere in the DOM', async () => {
    mockApiFetch.mockResolvedValue(MOCK_PROVIDERS);
    const { container } = render(<ProvidersSection />);
    await waitFor(() => {
      expect(screen.getByTestId('providers-list')).toBeInTheDocument();
    });
    const html = container.innerHTML;
    expect(html).not.toContain('maskedKey');
    expect(html).not.toContain('apiKey');
    expect(html).not.toContain('API_KEY');
    expect(html).not.toContain('requiredEnvVars');
  });
});
