// @vitest-environment jsdom
// packages/web/src/components/Settings/__tests__/TelegramDashboard.test.tsx

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

import { TelegramDashboard } from '../TelegramDashboard';
import type { TelegramConfig, TelegramStatus } from '../telegram/types';

const defaultConfig: TelegramConfig = {
  enabled: true,
  botToken: 'test-token',
  allowedChatIds: ['123456', '789012'],
  rateLimitPerMinute: 20,
  notifications: {
    enabledCategories: ['agent_crashed', 'decision_needs_approval', 'system_alert', 'task_completed'],
    quietHours: { enabled: true, startHour: 22, endHour: 8 },
  },
};

const defaultStatus: TelegramStatus = {
  enabled: true,
  adapters: [{ platform: 'telegram', running: true }],
  sessions: [
    {
      chatId: '123456',
      platform: 'telegram',
      projectId: 'my-project',
      boundBy: 'admin',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    },
  ],
  pendingNotifications: 2,
  subscriptions: 1,
};

describe('TelegramDashboard', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ ok: true });
  });

  it('renders the dashboard with connected status', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByTestId('telegram-dashboard')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows disconnected status when adapter is not running', () => {
    const disconnectedStatus = {
      ...defaultStatus,
      adapters: [{ platform: 'telegram', running: false }],
    };

    render(
      <TelegramDashboard
        config={defaultConfig}
        status={disconnectedStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('displays linked chats with their IDs', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText('789012')).toBeInTheDocument();
  });

  it('shows bound session info for linked chats', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText(/my-project/)).toBeInTheDocument();
  });

  it('shows quick stats', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText('2 pending')).toBeInTheDocument();
    expect(screen.getByText('1 subscription')).toBeInTheDocument();
    expect(screen.getByText('1 active session')).toBeInTheDocument();
  });

  it('shows notification summary', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('shows quiet hours when enabled', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText(/22:00/)).toBeInTheDocument();
  });

  it('calls onReconfigure when Run Setup Again is clicked', () => {
    const onReconfigure = vi.fn();
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={onReconfigure}
      />,
    );

    fireEvent.click(screen.getByText('Run Setup Again'));
    expect(onReconfigure).toHaveBeenCalledOnce();
  });

  it('shows Disable Integration button', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText('Disable Integration')).toBeInTheDocument();
  });

  it('does not show In Development badge', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.queryByText('In Development')).not.toBeInTheDocument();
  });

  it('shows Add Chat button', () => {
    render(
      <TelegramDashboard
        config={defaultConfig}
        status={defaultStatus}
        onReconfigure={vi.fn()}
      />,
    );

    expect(screen.getByText('Add Chat')).toBeInTheDocument();
  });
});
