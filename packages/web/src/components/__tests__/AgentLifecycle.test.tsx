// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentLifecycle } from '../AgentLifecycle';
import type { AgentHealthInfo } from '../../pages/CrewHealth';

// ── Mock apiFetch ───────────────────────────────────────────────────

const mockApiFetch = vi.fn();

vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Test Data ───────────────────────────────────────────────────────

const MOCK_AGENT: AgentHealthInfo = {
  agentId: 'agent-001-full-id',
  role: 'developer',
  model: 'gpt-4',
  status: 'idle',
  uptimeMs: 3_600_000,
};

const defaultProps = {
  agentId: 'agent-001-full-id',
  teamId: 'team-1',
  agent: MOCK_AGENT,
  onClose: vi.fn(),
  onActionComplete: vi.fn(),
};

// ── Tests ───────────────────────────────────────────────────────────

describe('AgentLifecycle', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    defaultProps.onClose.mockReset();
    defaultProps.onActionComplete.mockReset();
  });

  it('renders modal with agent info', () => {
    render(<AgentLifecycle {...defaultProps} />);
    expect(screen.getByTestId('agent-lifecycle-modal')).toBeInTheDocument();
    expect(screen.getByText('agent-00')).toBeInTheDocument();
    expect(screen.getByText(/developer/)).toBeInTheDocument();
  });

  it('shows two action buttons', () => {
    render(<AgentLifecycle {...defaultProps} />);
    expect(screen.getByTestId('action-clone')).toBeInTheDocument();
    expect(screen.getByTestId('action-retrain')).toBeInTheDocument();
  });

  it('shows confirmation dialog on clone click', () => {
    render(<AgentLifecycle {...defaultProps} />);
    fireEvent.click(screen.getByTestId('action-clone'));

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Clone Agent')).toBeInTheDocument();
  });

  it('cancels confirmation dialog', () => {
    render(<AgentLifecycle {...defaultProps} />);
    fireEvent.click(screen.getByTestId('action-clone'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('executes clone action on confirm', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, clone: { agentId: 'clone-abc' } });
    render(<AgentLifecycle {...defaultProps} />);

    fireEvent.click(screen.getByTestId('action-clone'));
    fireEvent.click(screen.getByTestId('confirm-button'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/teams/team-1/agents/agent-001-full-id/clone',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(screen.getByTestId('action-result')).toHaveTextContent(/cloned/i);
    expect(defaultProps.onActionComplete).toHaveBeenCalled();
  });

  it('shows error on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    render(<AgentLifecycle {...defaultProps} />);

    fireEvent.click(screen.getByTestId('action-clone'));
    fireEvent.click(screen.getByTestId('confirm-button'));

    await waitFor(() => {
      expect(screen.getByTestId('action-result')).toHaveTextContent(/server error/i);
    });

    expect(screen.getByTestId('action-result')).toHaveAttribute('role', 'alert');
  });

  it('closes on X button', () => {
    render(<AgentLifecycle {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    render(<AgentLifecycle {...defaultProps} />);
    fireEvent.click(screen.getByTestId('agent-lifecycle-modal'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('does not close on inner content click', () => {
    render(<AgentLifecycle {...defaultProps} />);
    fireEvent.click(screen.getByText('Agent Lifecycle'));
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
