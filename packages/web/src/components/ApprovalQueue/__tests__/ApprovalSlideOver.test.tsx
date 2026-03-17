import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';

// Mock ApprovalQueue to avoid deep dependency tree
vi.mock('../ApprovalQueue', () => ({
  ApprovalQueue: () => <div data-testid="approval-queue-content">Queue</div>,
}));

// Mock WebSocket
const mockSendWsMessage = vi.fn();
vi.mock('../../../hooks/useWebSocket', () => ({
  sendWsMessage: (...args: unknown[]) => mockSendWsMessage(...args),
}));

import { ApprovalSlideOver } from '../ApprovalSlideOver';

describe('ApprovalSlideOver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      approvalQueueOpen: false,
      pendingDecisions: [],
      setApprovalQueueOpen: (open: boolean) =>
        useAppStore.setState({ approvalQueueOpen: open }),
    });
  });

  it('renders nothing when not open', () => {
    const { container } = render(<ApprovalSlideOver />);
    expect(container.innerHTML).toBe('');
  });

  it('renders slide-over panel when open', () => {
    useAppStore.setState({ approvalQueueOpen: true });
    render(<ApprovalSlideOver />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Approval Queue')).toBeTruthy();
  });

  it('shows pending count', () => {
    useAppStore.setState({
      approvalQueueOpen: true,
      pendingDecisions: [{ id: '1' }, { id: '2' }] as any[],
    });
    render(<ApprovalSlideOver />);
    expect(screen.getByText('2 pending')).toBeTruthy();
  });

  it('closes on close button click', () => {
    useAppStore.setState({ approvalQueueOpen: true });
    render(<ApprovalSlideOver />);
    fireEvent.click(screen.getByLabelText('Close approval queue'));
    expect(useAppStore.getState().approvalQueueOpen).toBe(false);
  });

  it('closes on Escape key', () => {
    useAppStore.setState({ approvalQueueOpen: true });
    render(<ApprovalSlideOver />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAppStore.getState().approvalQueueOpen).toBe(false);
  });

  it('sends queue_open message when opened', () => {
    useAppStore.setState({ approvalQueueOpen: true });
    render(<ApprovalSlideOver />);
    expect(mockSendWsMessage).toHaveBeenCalledWith({ type: 'queue_open' });
  });

  it('renders ApprovalQueue content inside panel', () => {
    useAppStore.setState({ approvalQueueOpen: true });
    render(<ApprovalSlideOver />);
    expect(screen.getByTestId('approval-queue-content')).toBeTruthy();
  });
});
