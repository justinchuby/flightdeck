import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────

const mockAppState = {
  connected: true,
  systemPaused: false,
  agents: [
    { id: 'a1', status: 'running', role: { id: 'dev' }, createdAt: '2026-03-08T10:00:00Z', childIds: [] },
    { id: 'a2', status: 'idle', role: { id: 'lead' }, createdAt: '2026-03-08T09:00:00Z', childIds: [] },
    { id: 'a3', status: 'terminated', role: { id: 'dev' }, createdAt: '2026-03-08T08:00:00Z', childIds: [] },
  ],
};

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: typeof mockAppState) => unknown) => selector(mockAppState),
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: (ts: string) => `relative(${ts})`,
}));

import { StatusPopover } from '../StatusPopover';

// ── Tests ─────────────────────────────────────────────────

describe('StatusPopover', () => {
  beforeEach(() => {
    mockAppState.connected = true;
    mockAppState.systemPaused = false;
    mockAppState.agents = [
      { id: 'a1', status: 'running', role: { id: 'dev' }, createdAt: '2026-03-08T10:00:00Z', childIds: [] },
      { id: 'a2', status: 'idle', role: { id: 'lead' }, createdAt: '2026-03-08T09:00:00Z', childIds: [] },
      { id: 'a3', status: 'terminated', role: { id: 'dev' }, createdAt: '2026-03-08T08:00:00Z', childIds: [] },
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders trigger with connected status', () => {
    render(<StatusPopover />);
    const trigger = screen.getByTestId('status-popover-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Server: Connected');
  });

  it('shows reconnecting when disconnected', () => {
    mockAppState.connected = false;
    render(<StatusPopover />);
    expect(screen.getByTestId('status-popover-trigger')).toHaveTextContent('Server: Reconnecting...');
  });

  it('shows paused when system is paused', () => {
    mockAppState.systemPaused = true;
    render(<StatusPopover />);
    expect(screen.getByTestId('status-popover-trigger')).toHaveTextContent('Server: Paused');
  });

  it('opens popover on click and shows status details', async () => {
    render(<StatusPopover />);

    expect(screen.queryByTestId('status-popover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('status-popover')).toBeInTheDocument();
    });

    expect(screen.getByText('System Status')).toBeInTheDocument();
    expect(screen.getByText('Server Connection')).toBeInTheDocument();
    expect(screen.getByText('Active Agents')).toBeInTheDocument();
    expect(screen.getByText('Last Activity')).toBeInTheDocument();
  });

  it('shows agent counts breakdown', async () => {
    render(<StatusPopover />);
    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      expect(screen.getByText('2 active')).toBeInTheDocument();
    });
    expect(screen.getByText('1 running, 1 idle')).toBeInTheDocument();
  });

  it('shows Healthy badge when all systems ok', async () => {
    render(<StatusPopover />);
    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });
  });

  it('shows Disconnected badge when ws is down', async () => {
    mockAppState.connected = false;
    render(<StatusPopover />);
    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      const matches = screen.getAllByText('Disconnected');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('closes on Escape key', async () => {
    render(<StatusPopover />);
    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('status-popover')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('status-popover')).not.toBeInTheDocument();
    });
  });

  it('closes on click outside', async () => {
    render(<div><StatusPopover /><div data-testid="outside">outside</div></div>);
    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('status-popover')).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByTestId('status-popover')).not.toBeInTheDocument();
    });
  });

  it('shows last activity with formatted time', async () => {
    render(<StatusPopover />);
    fireEvent.click(screen.getByTestId('status-popover-trigger'));

    await waitFor(() => {
      expect(screen.getByText('relative(2026-03-08T10:00:00Z)')).toBeInTheDocument();
    });
  });
});
