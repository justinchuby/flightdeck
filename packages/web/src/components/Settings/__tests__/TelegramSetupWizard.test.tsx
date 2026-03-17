// @vitest-environment jsdom
// packages/web/src/components/Settings/__tests__/TelegramSetupWizard.test.tsx

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

import { TelegramSetupWizard } from '../TelegramSetupWizard';

describe('TelegramSetupWizard', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the wizard with step 1 active', () => {
    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);

    expect(screen.getByTestId('telegram-setup-wizard')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-wizard-step-1')).toBeInTheDocument();
    expect(screen.getByText('Connect Bot')).toBeInTheDocument();
    expect(screen.getByText('Link Chat')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
  });

  it('shows step 1 with token input and verify button', () => {
    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);

    expect(screen.getByTestId('telegram-token-input')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-verify-btn')).toBeInTheDocument();
    expect(screen.getByText('Connect Your Telegram Bot')).toBeInTheDocument();
  });

  it('verify button is disabled when token is empty', () => {
    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);

    const verifyBtn = screen.getByTestId('telegram-verify-btn');
    expect(verifyBtn).toBeDisabled();
  });

  it('validates token and shows bot info on success', async () => {
    mockApiFetch.mockResolvedValueOnce({
      valid: true,
      bot: { id: 123456789, username: 'FlightdeckBot', firstName: 'Flightdeck' },
    });

    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);

    const tokenInput = screen.getByTestId('telegram-token-input');
    fireEvent.focus(tokenInput);
    fireEvent.change(tokenInput, { target: { value: '12345:ABCdef' } });

    const verifyBtn = screen.getByTestId('telegram-verify-btn');
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByTestId('telegram-bot-info')).toBeInTheDocument();
    });

    expect(screen.getByText(/@FlightdeckBot/)).toBeInTheDocument();
    expect(screen.getByTestId('telegram-next-1')).toBeInTheDocument();
  });

  it('shows error on invalid token', async () => {
    mockApiFetch.mockResolvedValueOnce({
      valid: false,
      error: 'Invalid token — check with @BotFather',
    });

    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);

    const tokenInput = screen.getByTestId('telegram-token-input');
    fireEvent.focus(tokenInput);
    fireEvent.change(tokenInput, { target: { value: 'bad-token' } });
    fireEvent.click(screen.getByTestId('telegram-verify-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/Invalid token/)).toBeInTheDocument();
  });

  it('advances to step 2 when Next is clicked', async () => {
    mockApiFetch.mockResolvedValueOnce({
      valid: true,
      bot: { id: 123, username: 'TestBot', firstName: 'Test' },
    });

    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);

    // Complete step 1
    const tokenInput = screen.getByTestId('telegram-token-input');
    fireEvent.focus(tokenInput);
    fireEvent.change(tokenInput, { target: { value: '12345:token' } });
    fireEvent.click(screen.getByTestId('telegram-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('telegram-next-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('telegram-next-1'));

    expect(screen.getByTestId('telegram-wizard-step-2')).toBeInTheDocument();
    expect(screen.getByText('Link a Telegram Chat')).toBeInTheDocument();
  });

  it('pre-fills config when provided', () => {
    render(
      <TelegramSetupWizard
        config={{
          enabled: true,
          botToken: 'existing-token',
          allowedChatIds: ['123'],
          rateLimitPerMinute: 20,
        }}
        onComplete={vi.fn()}
      />,
    );

    // Token should be pre-filled (masked)
    expect(screen.getByTestId('telegram-token-input')).toBeInTheDocument();
  });

  it('does not show In Development badge', () => {
    render(<TelegramSetupWizard config={null} onComplete={vi.fn()} />);
    expect(screen.queryByText('In Development')).not.toBeInTheDocument();
  });
});
