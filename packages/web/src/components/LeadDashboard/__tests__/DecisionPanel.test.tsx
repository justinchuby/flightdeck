// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BannerDecisionActions, DecisionPanelContent } from '../DecisionPanel';
import type { Decision } from '../../../types';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    title: 'Use React',
    rationale: 'Team expertise',
    agentRole: 'architect',
    status: 'recorded',
    timestamp: '2026-03-14T10:00:00Z',
    ...overrides,
  } as Decision;
}

describe('BannerDecisionActions', () => {
  it('renders comment input and action buttons', () => {
    render(<BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByPlaceholderText('Comment (optional)...')).toBeDefined();
    expect(screen.getByLabelText('Confirm decision')).toBeDefined();
    expect(screen.getByLabelText('Reject decision')).toBeDefined();
  });

  it('calls onConfirm with id when clicked', () => {
    const onConfirm = vi.fn();
    render(<BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Confirm decision'));
    expect(onConfirm).toHaveBeenCalledWith('d1', undefined);
  });

  it('calls onConfirm with reason when text entered', () => {
    const onConfirm = vi.fn();
    render(<BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Comment (optional)...'), { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByLabelText('Confirm decision'));
    expect(onConfirm).toHaveBeenCalledWith('d1', 'Looks good');
  });

  it('calls onReject when clicked', () => {
    const onReject = vi.fn();
    render(<BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByLabelText('Reject decision'));
    expect(onReject).toHaveBeenCalledWith('d1', undefined);
  });

  it('shows dismiss button only when onDismiss provided', () => {
    const { rerender } = render(<BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={vi.fn()} />);
    expect(screen.queryByLabelText('Dismiss decision')).toBeNull();
    rerender(<BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText('Dismiss decision')).toBeDefined();
  });

  it('Enter in input triggers confirm', () => {
    const onConfirm = vi.fn();
    render(<BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />);
    const input = screen.getByPlaceholderText('Comment (optional)...');
    fireEvent.change(input, { target: { value: 'LGTM' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('d1', 'LGTM');
  });
});

describe('DecisionPanelContent', () => {
  it('shows "No decisions yet" when empty', () => {
    render(<DecisionPanelContent decisions={[]} />);
    expect(screen.getByText('No decisions yet')).toBeDefined();
  });

  it('renders decision titles', () => {
    render(<DecisionPanelContent decisions={[makeDecision(), makeDecision({ id: 'dec-2', title: 'Use TypeScript' })]} />);
    expect(screen.getByText('Use React')).toBeDefined();
    expect(screen.getByText('Use TypeScript')).toBeDefined();
  });

  it('shows agent role badge', () => {
    render(<DecisionPanelContent decisions={[makeDecision()]} />);
    expect(screen.getByText('architect')).toBeDefined();
  });

  it('shows status badge for non-recorded decisions', () => {
    render(<DecisionPanelContent decisions={[makeDecision({ status: 'confirmed' })]} />);
    expect(screen.getByText('confirmed')).toBeDefined();
  });

  it('shows rationale text', () => {
    render(<DecisionPanelContent decisions={[makeDecision()]} />);
    expect(screen.getByText('Team expertise')).toBeDefined();
  });

  it('clicking decision opens detail popup', () => {
    render(<DecisionPanelContent decisions={[makeDecision()]} />);
    fireEvent.click(screen.getByText('Use React'));
    expect(screen.getByText('Decision')).toBeDefined();
    expect(screen.getByLabelText('Close decision detail')).toBeDefined();
  });

  it('closes popup on close button', () => {
    render(<DecisionPanelContent decisions={[makeDecision()]} />);
    fireEvent.click(screen.getByText('Use React'));
    fireEvent.click(screen.getByLabelText('Close decision detail'));
    expect(screen.queryByLabelText('Close decision detail')).toBeNull();
  });

  it('shows confirm/reject buttons for needsConfirmation decisions', () => {
    const onConfirm = vi.fn();
    render(<DecisionPanelContent decisions={[makeDecision({ needsConfirmation: true })]} onConfirm={onConfirm} onReject={vi.fn()} />);
    expect(screen.getByText('Confirm')).toBeDefined();
    expect(screen.getByText('Reject')).toBeDefined();
  });
});
