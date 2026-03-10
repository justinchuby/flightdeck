// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TelegramSettings } from '../TelegramSettings';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────

const MOCK_STATUS = {
  enabled: true,
  adapters: [{ platform: 'telegram', running: true }],
  sessions: [
    {
      chatId: '123456',
      platform: 'telegram',
      projectId: 'project-1',
      boundBy: 'user-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  ],
  pendingNotifications: 2,
  subscriptions: 1,
};

const MOCK_CONFIG = {
  telegram: {
    enabled: true,
    botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v',
    allowedChatIds: ['111', '222'],
    rateLimitPerMinute: 20,
  },
};

const MOCK_STATUS_DISABLED = {
  enabled: false,
  adapters: [],
  sessions: [],
  pendingNotifications: 0,
  subscriptions: 0,
};

const MOCK_CONFIG_DISABLED = {
  telegram: {
    enabled: false,
    botToken: '',
    allowedChatIds: [],
    rateLimitPerMinute: 20,
  },
};

// ── Tests ─────────────────────────────────────────────────

describe('TelegramSettings', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('renders loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<TelegramSettings />);
    expect(screen.getByText('Loading Telegram settings…')).toBeInTheDocument();
  });

  it('renders Telegram Integration header after loading', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Telegram Integration')).toBeInTheDocument();
    });
  });

  it('shows Connected status when adapter is running', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      const statusEl = screen.getByTestId('telegram-status');
      expect(statusEl.textContent).toContain('Connected');
    });
  });

  it('shows Disabled status when not enabled', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS_DISABLED)
      .mockResolvedValueOnce(MOCK_CONFIG_DISABLED);
    render(<TelegramSettings />);
    await waitFor(() => {
      const statusEl = screen.getByTestId('telegram-status');
      expect(statusEl.textContent).toContain('Disabled');
    });
  });

  it('has enable/disable toggle', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-toggle')).toBeInTheDocument();
    });
  });

  it('toggles enabled state and calls API', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockResolvedValueOnce({}); // PATCH response
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-toggle'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/integrations/telegram',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('renders bot token input', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-token-input')).toBeInTheDocument();
    });
  });

  it('masks bot token by default', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      const input = screen.getByTestId('telegram-token-input') as HTMLInputElement;
      expect(input.type).toBe('password');
    });
  });

  it('has Test Connection button', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-test-btn')).toBeInTheDocument();
    });
  });

  it('sends test message on Test button click', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockResolvedValueOnce({ sent: true }); // test response
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-test-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-test-btn'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/integrations/test-message',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows test result on success', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockResolvedValueOnce({ sent: true });
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-test-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-test-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('telegram-test-result')).toBeInTheDocument();
    });
    expect(screen.getByText('Test message sent successfully')).toBeInTheDocument();
  });

  it('shows test result on failure', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockRejectedValueOnce(new Error('Bot token invalid'));
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-test-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-test-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('telegram-test-result')).toBeInTheDocument();
    });
    expect(screen.getByText(/Bot token invalid/)).toBeInTheDocument();
  });

  // ── Allowed Chat IDs ──────────────────────────────────

  it('renders allowed chat IDs from config', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-chatid-list')).toBeInTheDocument();
    });
    expect(screen.getByText('111')).toBeInTheDocument();
    expect(screen.getByText('222')).toBeInTheDocument();
  });

  it('adds new chat ID', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-chatid-input')).toBeInTheDocument();
    });
    const input = screen.getByTestId('telegram-chatid-input');
    fireEvent.change(input, { target: { value: '333' } });
    fireEvent.click(screen.getByTestId('telegram-add-chatid'));
    expect(screen.getByText('333')).toBeInTheDocument();
  });

  it('removes a chat ID', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('111')).toBeInTheDocument();
    });
    const removeBtn = screen.getByLabelText('Remove chat ID 111');
    fireEvent.click(removeBtn);
    expect(screen.queryByText('111')).not.toBeInTheDocument();
  });

  it('shows empty message when no chat IDs configured', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS_DISABLED)
      .mockResolvedValueOnce(MOCK_CONFIG_DISABLED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText(/all chats will be allowed/)).toBeInTheDocument();
    });
  });

  // ── Rate Limit ────────────────────────────────────────

  it('renders rate limit slider', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-rate-limit')).toBeInTheDocument();
    });
    expect(screen.getByText('20/min')).toBeInTheDocument();
  });

  // ── Notification Categories ───────────────────────────

  it('renders notification category toggles', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Notification Types')).toBeInTheDocument();
    });
    expect(screen.getByText('Decisions needing approval')).toBeInTheDocument();
    expect(screen.getByText('Agent crashes')).toBeInTheDocument();
    expect(screen.getByText('Task completions')).toBeInTheDocument();
  });

  it('marks critical notifications as always-on', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Notification Types')).toBeInTheDocument();
    });
    const alwaysOnBadges = screen.getAllByText('always on');
    expect(alwaysOnBadges.length).toBe(3); // decisions, crashes, system alerts
  });

  // ── Quiet Hours ───────────────────────────────────────

  it('has quiet hours toggle', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-quiet-toggle')).toBeInTheDocument();
    });
  });

  it('shows time selectors when quiet hours enabled', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-quiet-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-quiet-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('telegram-quiet-start')).toBeInTheDocument();
      expect(screen.getByTestId('telegram-quiet-end')).toBeInTheDocument();
    });
  });

  it('shows critical notification warning during quiet hours', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-quiet-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-quiet-toggle'));
    await waitFor(() => {
      expect(screen.getByText(/Critical notifications.*always delivered/)).toBeInTheDocument();
    });
  });

  // ── Active Sessions ───────────────────────────────────

  it('shows active sessions', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Active Sessions (1)')).toBeInTheDocument();
    });
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText('→ project-1')).toBeInTheDocument();
  });

  // ── Save ──────────────────────────────────────────────

  it('has save button', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-save-btn')).toBeInTheDocument();
    });
  });

  it('saves config on click', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce(MOCK_STATUS); // refresh status
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-save-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-save-btn'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/integrations/telegram',
        expect.objectContaining({
          method: 'PATCH',
        }),
      );
    });
  });

  // ── Error Handling ────────────────────────────────────

  it('shows error state on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  // ── Security ──────────────────────────────────────────

  it('does not expose raw bot token in DOM', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    const { container } = render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-token-input')).toBeInTheDocument();
    });
    const html = container.innerHTML;
    // Full token should not appear in visible text
    expect(html).not.toContain('bot123456:ABC-DEF1234ghIkl-zyx57W2v');
  });

  it('recommends environment variable for token', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText(/TELEGRAM_BOT_TOKEN/)).toBeInTheDocument();
    });
  });
});
