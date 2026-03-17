// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BannerDecisionActions, DecisionPanelContent } from '../DecisionPanel';
import type { Decision } from '../../../types';

afterEach(cleanup);

function makeDecision(id: string, overrides: Partial<Decision> = {}): Decision {
  return {
    id,
    title: `Decision ${id}`,
    rationale: `Rationale for ${id}`,
    agentId: 'a1',
    status: 'recorded',
    timestamp: '2024-06-15T10:00:00Z',
    createdAt: '2024-06-15T10:00:00Z',
    needsConfirmation: false,
    ...overrides,
  } as Decision;
}

describe('BannerDecisionActions — extra', () => {
  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <BannerDecisionActions
        decisionId="d1"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss decision'));
    expect(onDismiss).toHaveBeenCalledWith('d1');
  });

  it('sends undefined reason when input is empty on confirm', () => {
    const onConfirm = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText('Confirm decision'));
    expect(onConfirm).toHaveBeenCalledWith('d1', undefined);
  });

  it('trims whitespace from reason', () => {
    const onConfirm = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText(/Comment/i);
    fireEvent.change(input, { target: { value: '  spaced  ' } });
    fireEvent.click(screen.getByLabelText('Confirm decision'));
    expect(onConfirm).toHaveBeenCalledWith('d1', 'spaced');
  });

  it('sends reason on reject', () => {
    const onReject = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={onReject} />,
    );
    const input = screen.getByPlaceholderText(/Comment/i);
    fireEvent.change(input, { target: { value: 'bad idea' } });
    fireEvent.click(screen.getByLabelText('Reject decision'));
    expect(onReject).toHaveBeenCalledWith('d1', 'bad idea');
  });

  it('does not crash on non-Enter key press', () => {
    const onConfirm = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText(/Comment/i);
    fireEvent.keyDown(input, { key: 'a' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('DecisionPanelContent — extra', () => {
  it('shows "No decisions yet" for empty array', () => {
    render(<DecisionPanelContent decisions={[]} />);
    expect(screen.getByText('No decisions yet')).toBeInTheDocument();
  });

  it('renders decision with agentRole badge', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { agentRole: 'developer' })]}
      />,
    );
    expect(screen.getByText('developer')).toBeInTheDocument();
  });

  it('renders confirmed status badge', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { status: 'confirmed' })]}
      />,
    );
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('renders rejected status badge', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { status: 'rejected' })]}
      />,
    );
    expect(screen.getByText('rejected')).toBeInTheDocument();
  });

  it('renders dismissed status badge', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { status: 'dismissed' })]}
      />,
    );
    expect(screen.getByText('dismissed')).toBeInTheDocument();
  });

  it('does not render status badge for recorded status', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { status: 'recorded' })]}
      />,
    );
    expect(screen.queryByText('recorded')).not.toBeInTheDocument();
  });

  it('shows confirm/reject/dismiss buttons for needsConfirmation+recorded', () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { needsConfirmation: true, status: 'recorded' })]}
        onConfirm={onConfirm}
        onReject={onReject}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('clicking confirm button calls onConfirm with decision id', () => {
    const onConfirm = vi.fn();
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { needsConfirmation: true, status: 'recorded' })]}
        onConfirm={onConfirm}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith('d1', undefined);
  });

  it('clicking reject button calls onReject', () => {
    const onReject = vi.fn();
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { needsConfirmation: true, status: 'recorded' })]}
        onConfirm={vi.fn()}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByText('Reject'));
    expect(onReject).toHaveBeenCalledWith('d1', undefined);
  });

  it('clicking dismiss button calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { needsConfirmation: true, status: 'recorded' })]}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('d1');
  });

  it('does not show dismiss button when onDismiss not provided', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { needsConfirmation: true, status: 'recorded' })]}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByText('Dismiss')).not.toBeInTheDocument();
  });

  it('inline reason input fires onConfirm on Enter', () => {
    const onConfirm = vi.fn();
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { needsConfirmation: true, status: 'recorded' })]}
        onConfirm={onConfirm}
        onReject={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(/Add a comment/i);
    fireEvent.change(input, { target: { value: 'looks good' } });
    fireEvent.keyDown(input, { key: 'Enter', nativeEvent: { isComposing: false } });
    expect(onConfirm).toHaveBeenCalledWith('d1', 'looks good');
  });

  it('clicking a decision opens detail popup', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { rationale: 'Important reason' })]}
      />,
    );
    fireEvent.click(screen.getByText('Decision d1'));
    // Detail popup should show — rationale appears in both list and popup so use getAllByText
    expect(screen.getByText('Rationale')).toBeInTheDocument();
    const importantReasons = screen.getAllByText('Important reason');
    expect(importantReasons.length).toBeGreaterThanOrEqual(2); // list + popup
  });

  it('detail popup shows agentRole when present', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', { agentRole: 'architect' })]}
      />,
    );
    fireEvent.click(screen.getByText('Decision d1'));
    expect(screen.getByText('by architect')).toBeInTheDocument();
  });

  it('detail popup shows alternatives when present', () => {
    const decision = {
      ...makeDecision('d1'),
      alternatives: ['Option A', 'Option B'],
    };
    render(<DecisionPanelContent decisions={[decision as any]} />);
    fireEvent.click(screen.getByText('Decision d1'));
    expect(screen.getByText('Alternatives considered')).toBeInTheDocument();
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('detail popup shows impact when present', () => {
    const decision = { ...makeDecision('d1'), impact: 'High impact change' };
    render(<DecisionPanelContent decisions={[decision as any]} />);
    fireEvent.click(screen.getByText('Decision d1'));
    expect(screen.getByText('Impact')).toBeInTheDocument();
    expect(screen.getByText('High impact change')).toBeInTheDocument();
  });

  it('closing detail popup via X button', () => {
    render(
      <DecisionPanelContent decisions={[makeDecision('d1')]} />,
    );
    fireEvent.click(screen.getByText('Decision d1'));
    // Click the close button
    fireEvent.click(screen.getByLabelText('Close decision detail'));
    // Popup should be gone
    expect(screen.queryByText('Rationale')).not.toBeInTheDocument();
  });

  it('closing detail popup via backdrop click', () => {
    render(
      <DecisionPanelContent decisions={[makeDecision('d1')]} />,
    );
    fireEvent.click(screen.getByText('Decision d1'));
    // The backdrop is the fixed overlay div
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/60');
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop!, { target: backdrop });
    expect(screen.queryByText('Rationale')).not.toBeInTheDocument();
  });

  it('renders multiple decisions', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1'), makeDecision('d2'), makeDecision('d3')]}
      />,
    );
    expect(screen.getByText('Decision d1')).toBeInTheDocument();
    expect(screen.getByText('Decision d2')).toBeInTheDocument();
    expect(screen.getByText('Decision d3')).toBeInTheDocument();
  });
});
