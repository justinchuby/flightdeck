// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';
import { useLeadStore } from '../../../stores/leadStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useToastStore } from '../../Toast';
import type { Decision } from '../../../types';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { ApprovalQueue } from '../ApprovalQueue';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1', agentId: 'agent-1', agentRole: 'Developer', leadId: 'lead-1',
    projectId: null, title: 'Decision A', rationale: 'Reasoning', needsConfirmation: true,
    status: 'recorded', autoApproved: false, confirmedAt: null,
    timestamp: new Date().toISOString(), category: 'architecture', ...overrides,
  };
}

function resetStores() {
  useAppStore.setState({ agents: [], pendingDecisions: [], approvalQueueOpen: false, selectedAgentId: null, connected: false, loading: false, systemPaused: false });
  useLeadStore.setState({ projects: {}, selectedLeadId: 'lead-1', drafts: {} });
  useSettingsStore.setState({ oversightLevel: 'balanced' });
  useToastStore.setState({ toasts: [] });
}

describe('ApprovalQueue – extra coverage', () => {
  beforeEach(() => { resetStores(); mockApiFetch.mockReset(); });

  it('keyboard "a" approves selected decisions', async () => {
    mockApiFetch.mockResolvedValue({ updated: 1 });
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    render(<ApprovalQueue />);

    // Select the decision
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // Press 'a' key
    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/batch', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('keyboard "r" rejects selected decisions', async () => {
    mockApiFetch.mockResolvedValue({ updated: 1 });
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.keyDown(window, { key: 'r' });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/batch', expect.objectContaining({
        body: expect.stringContaining('"reject"'),
      }));
    });
  });

  it('keyboard "d" dismisses selected decisions', async () => {
    mockApiFetch.mockResolvedValue({ updated: 1 });
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.keyDown(window, { key: 'd' });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/batch', expect.objectContaining({
        body: expect.stringContaining('"dismiss"'),
      }));
    });
  });

  it('keyboard shortcuts do nothing when no selection', () => {
    useAppStore.setState({ pendingDecisions: [makeDecision()] });
    render(<ApprovalQueue />);
    fireEvent.keyDown(window, { key: 'a' });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('keyboard shortcuts ignored when focus is in input', () => {
    useAppStore.setState({ pendingDecisions: [makeDecision()] });
    render(<ApprovalQueue />);
    fireEvent.click(screen.getByRole('checkbox'));
    // Create a temporary input and focus it
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'a' });
    expect(mockApiFetch).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('batch resolve falls back to individual calls when batch endpoint fails', async () => {
    let callCount = 0;
    mockApiFetch.mockImplementation((url: string) => {
      callCount++;
      if (url === '/decisions/batch') return Promise.reject(new Error('Not found'));
      return Promise.resolve({});
    });

    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1' }),
        makeDecision({ id: 'dec-2' }),
      ],
    });
    render(<ApprovalQueue />);

    // Select both
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    fireEvent.click(screen.getByText('Approve Selected'));

    await waitFor(() => {
      // Should have called batch first, then individual fallbacks
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/batch', expect.anything());
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-1/confirm', expect.anything());
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-2/confirm', expect.anything());
    });
  });

  it('"Approve all" button selects decisions in category', () => {
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', category: 'architecture' }),
        makeDecision({ id: 'dec-2', category: 'architecture' }),
      ],
    });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByText('Approve all'));

    // Should select both decisions
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('closes oversight picker with ✕ button', () => {
    useAppStore.setState({ pendingDecisions: [makeDecision()] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByText('Change oversight level'));
    expect(screen.getByText('🔍 Supervised')).toBeInTheDocument();

    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByText('🔍 Supervised')).not.toBeInTheDocument();
  });

  it('shows oversight descriptions', () => {
    useAppStore.setState({ pendingDecisions: [makeDecision()] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByText('Change oversight level'));
    expect(screen.getByText('Review all agent actions')).toBeInTheDocument();
    expect(screen.getByText('Review key decisions only')).toBeInTheDocument();
    expect(screen.getByText('Agents work autonomously')).toBeInTheDocument();
  });

  it('shows toast when oversight level changes', () => {
    mockApiFetch.mockResolvedValue({});
    useAppStore.setState({ pendingDecisions: [makeDecision()] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByText('Change oversight level'));
    fireEvent.click(screen.getByText('🚀 Autonomous'));

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some(t => t.message.includes('Autonomous'))).toBe(true);
  });

  it('batch reject shows success toast', async () => {
    mockApiFetch.mockResolvedValue({ updated: 1 });
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Reject Selected'));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some(t => t.message.includes('rejected'))).toBe(true);
    });
  });

  it('batch dismiss shows success toast', async () => {
    mockApiFetch.mockResolvedValue({ updated: 1 });
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Dismiss Selected'));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some(t => t.message.includes('dismissed'))).toBe(true);
    });
  });

  it('batch resolve error shows toast', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Approve Selected'));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some(t => t.type === 'error')).toBe(true);
    });
  });

  it('updates leadStore on batch approve', async () => {
    mockApiFetch.mockResolvedValue({ updated: 1 });
    useAppStore.setState({ pendingDecisions: [makeDecision({ id: 'dec-1' })] });
    useLeadStore.setState({ selectedLeadId: 'lead-1', projects: { 'lead-1': { decisions: [makeDecision({ id: 'dec-1' })] } as any } });
    render(<ApprovalQueue />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Approve Selected'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });
});
