// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockAppState = { connected: true };
vi.mock('../../stores/appStore', () => ({
  useAppStore: (selector: (s: typeof mockAppState) => unknown) => selector(mockAppState),
}));

import { AgentServerStatus } from '../AgentServerStatus';

function fireWsEvent(data: Record<string, unknown>) {
  const event = new MessageEvent('ws-message', { data: JSON.stringify(data) });
  window.dispatchEvent(event);
}

describe('AgentServerStatus', () => {
  beforeEach(() => {
    mockAppState.connected = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when connected (default)', () => {
    const { container } = render(<AgentServerStatus />);
    expect(container.innerHTML).toBe('');
  });

  it('shows red banner when disconnected', () => {
    render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'disconnected' });
    });
    expect(screen.getByTestId('agent-server-disconnected')).toBeInTheDocument();
    expect(screen.getByText(/agent server disconnected/i)).toBeInTheDocument();
  });

  it('shows amber banner when degraded', () => {
    render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'degraded' });
    });
    expect(screen.getByTestId('agent-server-degraded')).toBeInTheDocument();
    expect(screen.getByText(/connection degraded/i)).toBeInTheDocument();
  });

  it('hides banner when state returns to connected', () => {
    const { container } = render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'disconnected' });
    });
    expect(screen.getByTestId('agent-server-disconnected')).toBeInTheDocument();

    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'connected' });
    });
    expect(container.innerHTML).toBe('');
  });

  it('shows detail message when provided', () => {
    render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'disconnected', detail: 'heartbeat timeout' });
    });
    expect(screen.getByText(/heartbeat timeout/i)).toBeInTheDocument();
  });

  it('transitions from degraded to disconnected', () => {
    render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'degraded' });
    });
    expect(screen.getByTestId('agent-server-degraded')).toBeInTheDocument();

    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'disconnected' });
    });
    expect(screen.getByTestId('agent-server-disconnected')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-server-degraded')).not.toBeInTheDocument();
  });

  it('ignores unrelated WS events', () => {
    const { container } = render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agent:text', agentId: '123', text: 'hello' });
    });
    expect(container.innerHTML).toBe('');
  });

  it('ignores malformed WS messages', () => {
    const { container } = render(<AgentServerStatus />);
    act(() => {
      window.dispatchEvent(new MessageEvent('ws-message', { data: 'not-json{{{' }));
    });
    expect(container.innerHTML).toBe('');
  });

  it('uses role="alert" for disconnected (non-dismissible)', () => {
    render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'disconnected' });
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses role="status" for degraded (informational)', () => {
    render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'degraded' });
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('cleans up event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<AgentServerStatus />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('ws-message', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('resets to connected when WS reconnects (connected goes false→true)', () => {
    mockAppState.connected = true;
    const { container, rerender } = render(<AgentServerStatus />);

    // Set to disconnected via WS event
    act(() => {
      fireWsEvent({ type: 'agentServerStatus', state: 'disconnected' });
    });
    expect(screen.getByTestId('agent-server-disconnected')).toBeInTheDocument();

    // Simulate WS disconnect
    mockAppState.connected = false;
    rerender(<AgentServerStatus />);

    // Simulate WS reconnect
    mockAppState.connected = true;
    rerender(<AgentServerStatus />);

    // Should reset to connected (no banner)
    expect(container.innerHTML).toBe('');
  });

  it('reads agentServerState from init message', () => {
    const { container } = render(<AgentServerStatus />);
    act(() => {
      fireWsEvent({ type: 'init', agents: [], agentServerState: 'degraded' });
    });
    expect(screen.getByTestId('agent-server-degraded')).toBeInTheDocument();

    // Connected state in init clears banner
    act(() => {
      fireWsEvent({ type: 'init', agents: [], agentServerState: 'connected' });
    });
    expect(container.innerHTML).toBe('');
  });
});
