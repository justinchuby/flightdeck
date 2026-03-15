// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LeadPendingDecisionsBanner } from '../LeadPendingDecisionsBanner';
import type { Decision } from '../../../types';

vi.mock('../DecisionPanel', () => ({
  BannerDecisionActions: ({ decisionId }: { decisionId: string }) => (
    <div data-testid={`decision-actions-${decisionId}`}>actions</div>
  ),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function makeDecision(overrides: Partial<Decision> & { id: string }): Decision {
  return {
    agentId: 'agent-1',
    agentRole: 'developer',
    leadId: 'lead-1',
    projectId: null,
    title: 'Use library X',
    rationale: 'It is fast and well-maintained',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: '2024-01-15T10:00:00Z',
    category: 'dependency',
    ...overrides,
  } as Decision;
}

const defaultCallbacks = {
  onConfirm: vi.fn().mockResolvedValue(undefined),
  onReject: vi.fn().mockResolvedValue(undefined),
  onDismiss: vi.fn().mockResolvedValue(undefined),
};

describe('LeadPendingDecisionsBanner', () => {
  it('renders nothing when no decisions', () => {
    const { container } = render(
      <LeadPendingDecisionsBanner pendingConfirmations={[]} {...defaultCallbacks} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows count text', () => {
    const decisions = [makeDecision({ id: 'd1' }), makeDecision({ id: 'd2' })];
    render(
      <LeadPendingDecisionsBanner pendingConfirmations={decisions} {...defaultCallbacks} />,
    );
    expect(screen.getByText(/2 decisions need your confirmation/)).toBeInTheDocument();
  });

  it('shows singular text for 1 decision', () => {
    render(
      <LeadPendingDecisionsBanner pendingConfirmations={[makeDecision({ id: 'd1' })]} {...defaultCallbacks} />,
    );
    expect(screen.getByText(/1 decision needs your confirmation/)).toBeInTheDocument();
  });

  it('starts collapsed', () => {
    render(
      <LeadPendingDecisionsBanner pendingConfirmations={[makeDecision({ id: 'd1' })]} {...defaultCallbacks} />,
    );
    expect(screen.queryByText('Use library X')).not.toBeInTheDocument();
  });

  it('expands on click showing decisions', () => {
    const decisions = [makeDecision({ id: 'd1', title: 'Use library X', rationale: 'Fast and stable' })];
    render(
      <LeadPendingDecisionsBanner pendingConfirmations={decisions} {...defaultCallbacks} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Use library X')).toBeInTheDocument();
    expect(screen.getByText('Fast and stable')).toBeInTheDocument();
  });

  it('shows decision title and rationale', () => {
    const decisions = [
      makeDecision({ id: 'd1', title: 'Add React Router', rationale: 'Needed for SPA navigation', agentRole: 'architect' }),
    ];
    render(
      <LeadPendingDecisionsBanner pendingConfirmations={decisions} {...defaultCallbacks} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Add React Router')).toBeInTheDocument();
    expect(screen.getByText('Needed for SPA navigation')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
  });
});
