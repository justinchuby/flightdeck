import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  StatusBadge,
  agentStatusProps,
  connectionStatusProps,
  providerStatusProps,
  projectStatusProps,
  type StatusVariant,
} from '../StatusBadge';

describe('StatusBadge', () => {
  // ── Rendering ──────────────────────────────────────────────

  it('renders label text', () => {
    render(<StatusBadge variant="success" label="Online" />);
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('applies role="status"', () => {
    render(<StatusBadge variant="success" label="Online" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('sets data-testid', () => {
    render(<StatusBadge variant="success" label="OK" />);
    expect(screen.getByTestId('status-badge')).toBeTruthy();
  });

  // ── Variants ───────────────────────────────────────────────

  it.each<StatusVariant>(['success', 'warning', 'error', 'info', 'neutral'])(
    'renders %s variant without errors',
    (variant) => {
      render(<StatusBadge variant={variant} label={`Label-${variant}`} />);
      expect(screen.getByText(`Label-${variant}`)).toBeTruthy();
    },
  );

  it('applies success color classes', () => {
    render(<StatusBadge variant="success" label="Active" />);
    const el = screen.getByTestId('status-badge');
    expect(el.className).toContain('text-green-400');
    expect(el.className).toContain('bg-green-400/10');
  });

  it('applies error color classes', () => {
    render(<StatusBadge variant="error" label="Terminated" />);
    const el = screen.getByTestId('status-badge');
    expect(el.className).toContain('text-red-400');
  });

  // ── Sizes ──────────────────────────────────────────────────

  it('defaults to sm size', () => {
    render(<StatusBadge variant="info" label="Busy" />);
    const el = screen.getByTestId('status-badge');
    expect(el.className).toContain('text-[10px]');
  });

  it('applies md size', () => {
    render(<StatusBadge variant="info" label="Busy" size="md" />);
    const el = screen.getByTestId('status-badge');
    expect(el.className).toContain('text-[11px]');
  });

  // ── Icon ───────────────────────────────────────────────────

  it('renders icon when provided', () => {
    render(
      <StatusBadge variant="success" label="OK" icon={<span data-testid="custom-icon">✓</span>} />,
    );
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
  });

  // ── Dot mode ───────────────────────────────────────────────

  it('renders dot with label in dot mode', () => {
    render(<StatusBadge variant="success" label="Active" dot />);
    const el = screen.getByTestId('status-badge');
    expect(el.textContent).toContain('Active');
    expect(el.getAttribute('aria-label')).toBe('Active');
  });

  it('renders pulse animation when pulse=true', () => {
    const { container } = render(
      <StatusBadge variant="success" label="Live" dot pulse />,
    );
    const pings = container.querySelectorAll('.animate-ping');
    expect(pings.length).toBeGreaterThan(0);
  });

  it('does not render pulse when pulse is not set', () => {
    const { container } = render(
      <StatusBadge variant="success" label="Active" dot />,
    );
    const pings = container.querySelectorAll('.animate-ping');
    expect(pings.length).toBe(0);
  });

  // ── className passthrough ──────────────────────────────────

  it('appends custom className', () => {
    render(<StatusBadge variant="neutral" label="Unknown" className="ml-2" />);
    const el = screen.getByTestId('status-badge');
    expect(el.className).toContain('ml-2');
  });
});

// ── Mapping helpers ─────────────────────────────────────────────────

describe('agentStatusProps', () => {
  it('maps running liveStatus to success', () => {
    expect(agentStatusProps('idle', 'running')).toEqual({ variant: 'success', label: 'Running' });
  });

  it('maps creating liveStatus to warning', () => {
    expect(agentStatusProps('idle', 'creating')).toEqual({ variant: 'warning', label: 'Starting' });
  });

  it('maps live idle liveStatus to info', () => {
    expect(agentStatusProps('busy', 'idle')).toEqual({ variant: 'info', label: 'Idle' });
  });

  it('maps idle DB status without liveStatus to Offline', () => {
    expect(agentStatusProps('idle')).toEqual({ variant: 'neutral', label: 'Offline' });
  });

  it('maps busy DB status without liveStatus to Offline', () => {
    expect(agentStatusProps('busy')).toEqual({ variant: 'neutral', label: 'Offline' });
  });

  it('maps idle DB status with null liveStatus to Offline', () => {
    expect(agentStatusProps('idle', null)).toEqual({ variant: 'neutral', label: 'Offline' });
  });

  it('maps terminated status to error', () => {
    expect(agentStatusProps('terminated')).toEqual({ variant: 'error', label: 'Terminated' });
  });

  it('maps retired status to neutral', () => {
    expect(agentStatusProps('retired')).toEqual({ variant: 'neutral', label: 'Retired' });
  });

  it('maps unknown status without liveStatus to Offline', () => {
    expect(agentStatusProps('custom')).toEqual({ variant: 'neutral', label: 'Offline' });
  });
});

describe('connectionStatusProps', () => {
  it('maps connected to success/Online', () => {
    expect(connectionStatusProps('connected')).toEqual({ variant: 'success', label: 'Online' });
  });

  it('maps reconnecting to warning', () => {
    expect(connectionStatusProps('reconnecting')).toEqual({ variant: 'warning', label: 'Reconnecting' });
  });

  it('maps disconnected to error', () => {
    expect(connectionStatusProps('disconnected')).toEqual({ variant: 'error', label: 'Disconnected' });
  });

  it('maps unknown state to neutral', () => {
    expect(connectionStatusProps('mystery')).toEqual({ variant: 'neutral', label: 'mystery' });
  });
});

describe('providerStatusProps', () => {
  it('maps installed+authenticated to success/Ready', () => {
    expect(providerStatusProps({ installed: true, authenticated: true }))
      .toEqual({ variant: 'success', label: 'Ready' });
  });

  it('maps installed+unauthenticated to warning', () => {
    expect(providerStatusProps({ installed: true, authenticated: false }))
      .toEqual({ variant: 'warning', label: 'Not authenticated' });
  });

  it('maps installed+null to info/Installed', () => {
    expect(providerStatusProps({ installed: true, authenticated: null }))
      .toEqual({ variant: 'info', label: 'Installed' });
  });

  it('maps not installed to neutral', () => {
    expect(providerStatusProps({ installed: false, authenticated: null }))
      .toEqual({ variant: 'neutral', label: 'Not installed' });
  });
});

describe('projectStatusProps', () => {
  it('returns Active with pulse when agents are running', () => {
    expect(projectStatusProps({ status: 'active', runningAgentCount: 2, idleAgentCount: 0, failedAgentCount: 0 }))
      .toEqual({ variant: 'success', label: 'Active', pulse: true });
  });

  it('returns Idle when agents exist but all idle', () => {
    expect(projectStatusProps({ status: 'active', runningAgentCount: 0, idleAgentCount: 3, failedAgentCount: 0 }))
      .toEqual({ variant: 'warning', label: 'Idle', pulse: false });
  });

  it('returns Error when agents have failed and none active', () => {
    expect(projectStatusProps({ status: 'active', runningAgentCount: 0, idleAgentCount: 0, failedAgentCount: 2 }))
      .toEqual({ variant: 'error', label: 'Error', pulse: false });
  });

  it('returns Stopped when no agents at all', () => {
    expect(projectStatusProps({ status: 'active', runningAgentCount: 0, idleAgentCount: 0, failedAgentCount: 0 }))
      .toEqual({ variant: 'neutral', label: 'Stopped', pulse: false });
  });

  it('returns Archived for archived projects regardless of agents', () => {
    expect(projectStatusProps({ status: 'archived', runningAgentCount: 1, idleAgentCount: 0, failedAgentCount: 0 }))
      .toEqual({ variant: 'neutral', label: 'Archived', pulse: false });
  });

  it('falls back to activeAgentCount when per-status counts are missing', () => {
    expect(projectStatusProps({ status: 'active', activeAgentCount: 3 }))
      .toEqual({ variant: 'success', label: 'Active', pulse: true });
  });

  it('returns Stopped when only activeAgentCount is 0', () => {
    expect(projectStatusProps({ status: 'active', activeAgentCount: 0 }))
      .toEqual({ variant: 'neutral', label: 'Stopped', pulse: false });
  });

  it('prefers running over failed when both present', () => {
    expect(projectStatusProps({ status: 'active', runningAgentCount: 1, idleAgentCount: 0, failedAgentCount: 2 }))
      .toEqual({ variant: 'success', label: 'Active', pulse: true });
  });
});
