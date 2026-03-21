// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { TelegramSettings } from '../TelegramSettings';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────

const MOCK_STATUS_CONFIGURED = {
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

const MOCK_CONFIG_CONFIGURED = {
  telegram: {
    enabled: true,
    botToken: 'bot123456:ABC-DEF1234ghIkl-zyx57W2v',
    allowedChatIds: ['111', '222'],
    rateLimitPerMinute: 20,
    notifications: {
      enabledCategories: ['agent_crashed', 'decision_needs_approval', 'system_alert'],
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
    },
  },
};

const MOCK_STATUS_UNCONFIGURED = {
  enabled: false,
  adapters: [],
  sessions: [],
  pendingNotifications: 0,
  subscriptions: 0,
};

const MOCK_CONFIG_UNCONFIGURED = {
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
    cleanup();
    mockApiFetch.mockReset();
  });

  // ── Loading ─────────────────────────────────────────────

  it('renders loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<TelegramSettings />);
    expect(screen.getByText('Loading Telegram settings…')).toBeInTheDocument();
  });

  it('renders Telegram Integration header after loading', async () => {
    // loadConfig called first, loadStatus second (Promise.all order)
    mockApiFetch
      .mockResolvedValueOnce(MOCK_CONFIG_UNCONFIGURED)
      .mockResolvedValueOnce(MOCK_STATUS_UNCONFIGURED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Telegram Integration')).toBeInTheDocument();
    });
  });

  // ── Mode Selection ──────────────────────────────────────

  it('shows wizard mode when not configured (no token)', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_CONFIG_UNCONFIGURED)
      .mockResolvedValueOnce(MOCK_STATUS_UNCONFIGURED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-setup-wizard')).toBeInTheDocument();
    });
  });

  it('shows dashboard mode when fully configured', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_CONFIG_CONFIGURED)
      .mockResolvedValueOnce(MOCK_STATUS_CONFIGURED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-dashboard')).toBeInTheDocument();
    });
  });

  it('shows wizard when token exists but no chat IDs', async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        telegram: { ...MOCK_CONFIG_CONFIGURED.telegram, allowedChatIds: [] },
      })
      .mockResolvedValueOnce(MOCK_STATUS_UNCONFIGURED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-setup-wizard')).toBeInTheDocument();
    });
  });

  // ── Bug Fixes ───────────────────────────────────────────

  it('does not show "In Development" badge', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_CONFIG_UNCONFIGURED)
      .mockResolvedValueOnce(MOCK_STATUS_UNCONFIGURED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Telegram Integration')).toBeInTheDocument();
    });
    expect(screen.queryByText('In Development')).not.toBeInTheDocument();
  });

  it('does not show incorrect "all chats will be allowed" message', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_CONFIG_UNCONFIGURED)
      .mockResolvedValueOnce(MOCK_STATUS_UNCONFIGURED);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Telegram Integration')).toBeInTheDocument();
    });
    expect(screen.queryByText(/all chats will be allowed/)).not.toBeInTheDocument();
  });

  // ── Notification category toggle (non-critical) ───────

  it('toggles a non-critical notification category', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Notification Types')).toBeInTheDocument();
    });
    // task_completed is non-critical — toggle it
    fireEvent.click(screen.getByTestId('telegram-notif-task_completed'));
    // Should not throw
  });

  it('does not toggle critical notification category', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('Notification Types')).toBeInTheDocument();
    });
    // decision_needs_approval is critical — clicking should have no effect (no toggle)
    const btn = screen.getByTestId('telegram-notif-decision_needs_approval');
    fireEvent.click(btn);
    // Critical item should still be visually indicated as always on
    expect(screen.getAllByText('always on').length).toBe(3);
  });

  // ── Disconnected status ───────────────────────────────

  it('shows Disconnected status when enabled but no adapter running', async () => {
    const disconnectedStatus = {
      ...MOCK_STATUS,
      enabled: true,
      adapters: [{ platform: 'telegram', running: false }],
    };
    mockApiFetch
      .mockResolvedValueOnce(disconnectedStatus)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      const statusEl = screen.getByTestId('telegram-status');
      expect(statusEl.textContent).toContain('Disconnected');
    });
  });

  // ── Config with notification preferences ──────────────

  it('loads notification categories and quiet hours from config', async () => {
    const configWithPrefs = {
      telegram: {
        ...MOCK_CONFIG.telegram,
        notifications: {
          enabledCategories: ['decision_needs_approval', 'agent_crashed', 'system_alert', 'task_completed'],
          quietHours: { enabled: true, startHour: 23, endHour: 7 },
        },
      },
    };
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(configWithPrefs);
    render(<TelegramSettings />);
    await waitFor(() => {
      // Quiet hours should auto-enable since config has them
      expect(screen.getByTestId('telegram-quiet-start')).toBeInTheDocument();
      expect(screen.getByTestId('telegram-quiet-end')).toBeInTheDocument();
    });
  });

  // ── Status summary bar ────────────────────────────────

  it('shows status summary when enabled', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText(/2 pending/)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 subscriptions/)).toBeInTheDocument();
    expect(screen.getByText(/1 sessions/)).toBeInTheDocument();
  });

  // ── Quiet hours time selection ────────────────────────

  it('changes quiet hours start time', async () => {
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
    });
    fireEvent.change(screen.getByTestId('telegram-quiet-start'), { target: { value: '21' } });
    // Should not throw; value change is accepted
  });

  // ── Toggle enable rollback on API failure ─────────────

  it('rolls back enabled state on toggle API failure', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockRejectedValueOnce(new Error('Toggle failed')); // PATCH fails
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-toggle')).toBeInTheDocument();
    });
    // Initial state: enabled=true. Toggle to disable.
    fireEvent.click(screen.getByTestId('telegram-toggle'));
    // After API fails, should rollback
    await waitFor(() => {
      const statusEl = screen.getByTestId('telegram-status');
      expect(statusEl.textContent).toContain('Connected');
    });
  });

  // ── Save error handling ───────────────────────────────

  it('shows error on save failure', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (opts?.method === 'PATCH') return Promise.reject(new Error('Save failed'));
      if (typeof path === 'string' && path.includes('/integrations/status')) return Promise.resolve(MOCK_STATUS);
      if (typeof path === 'string' && path.includes('/config')) return Promise.resolve(MOCK_CONFIG);
      return Promise.resolve({});
    });
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-save-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-save-btn'));
    await waitFor(() => {
      expect(screen.getByText(/Save failed/)).toBeInTheDocument();
    });
  });

  // ── Chat ID Enter key ─────────────────────────────────

  it('adds chat ID on Enter key press', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-chatid-input')).toBeInTheDocument();
    });
    const input = screen.getByTestId('telegram-chatid-input');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('999')).toBeInTheDocument();
  });

  // ── Token focus unmasks ───────────────────────────────

  it('unmasks token on focus', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      const input = screen.getByTestId('telegram-token-input') as HTMLInputElement;
      expect(input.type).toBe('password');
    });
    fireEvent.focus(screen.getByTestId('telegram-token-input'));
    await waitFor(() => {
      const input = screen.getByTestId('telegram-token-input') as HTMLInputElement;
      expect(input.type).toBe('text');
    });
  });

  // ── Save success shows "Saved ✓" ─────────────────────

  it('shows success state after saving', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG)
      .mockResolvedValueOnce({}) // PATCH success
      .mockResolvedValueOnce(MOCK_STATUS); // refresh status
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('telegram-save-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('telegram-save-btn'));
    await waitFor(() => {
      expect(screen.getByText('Saved ✓')).toBeInTheDocument();
    });
  });

  // ── Duplicate chat ID prevention ──────────────────────

  it('does not add duplicate chat ID', async () => {
    mockApiFetch
      .mockResolvedValueOnce(MOCK_STATUS)
      .mockResolvedValueOnce(MOCK_CONFIG);
    render(<TelegramSettings />);
    await waitFor(() => {
      expect(screen.getByText('111')).toBeInTheDocument();
    });
    const input = screen.getByTestId('telegram-chatid-input');
    fireEvent.change(input, { target: { value: '111' } });
    fireEvent.click(screen.getByTestId('telegram-add-chatid'));
    // Should still only have one instance of '111'
    expect(screen.getAllByText('111')).toHaveLength(1);
  });
});
