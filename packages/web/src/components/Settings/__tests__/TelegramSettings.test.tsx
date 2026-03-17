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
});
