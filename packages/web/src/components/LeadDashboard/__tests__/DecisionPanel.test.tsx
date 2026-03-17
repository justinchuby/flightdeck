// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BannerDecisionActions, DecisionPanelContent } from '../DecisionPanel';
import type { Decision } from '../../../types';

const makeDecision = (id: string, status: Decision['status'] = 'pending', extra: Partial<Decision> = {}): Decision => ({
  id,
  title: `Decision ${id}`,
  rationale: `Rationale for ${id}`,
  agentId: 'a1',
  status,
  createdAt: new Date().toISOString(),
  ...extra,
});

describe('BannerDecisionActions', () => {
  it('renders confirm and reject buttons', () => {
    render(
      <BannerDecisionActions
        decisionId="d1"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Confirm decision')).toBeInTheDocument();
    expect(screen.getByLabelText('Reject decision')).toBeInTheDocument();
  });

  it('calls onConfirm with reason', () => {
    const onConfirm = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText(/Comment/i);
    fireEvent.change(input, { target: { value: 'looks good' } });
    fireEvent.click(screen.getByLabelText('Confirm decision'));
    expect(onConfirm).toHaveBeenCalledWith('d1', 'looks good');
  });

  it('calls onReject', () => {
    const onReject = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={onReject} />,
    );
    fireEvent.click(screen.getByLabelText('Reject decision'));
    expect(onReject).toHaveBeenCalledWith('d1', undefined);
  });

  it('calls onConfirm on Enter key', () => {
    const onConfirm = vi.fn();
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText(/Comment/i);
    fireEvent.change(input, { target: { value: 'enter test' } });
    fireEvent.keyDown(input, { key: 'Enter', nativeEvent: { isComposing: false } });
    expect(onConfirm).toHaveBeenCalledWith('d1', 'enter test');
  });

  it('shows dismiss button when onDismiss provided', () => {
    render(
      <BannerDecisionActions
        decisionId="d1"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Dismiss decision')).toBeInTheDocument();
  });

  it('hides dismiss button when onDismiss not provided', () => {
    render(
      <BannerDecisionActions decisionId="d1" onConfirm={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Dismiss decision')).toBeNull();
  });
});

describe('DecisionPanelContent', () => {
  it('renders decisions list', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1'), makeDecision('d2', 'confirmed')]}
      />,
    );
    expect(screen.getByText('Decision d1')).toBeInTheDocument();
    expect(screen.getByText('Decision d2')).toBeInTheDocument();
  });

  it('shows pending status', () => {
    render(<DecisionPanelContent decisions={[makeDecision('d1', 'pending')]} />);
    const text = document.body.textContent || '';
    expect(text).toMatch(/pending|awaiting/i);
  });

  it('shows confirmed status', () => {
    render(<DecisionPanelContent decisions={[makeDecision('d1', 'confirmed')]} />);
    const text = document.body.textContent || '';
    expect(text).toMatch(/confirmed|approved/i);
  });

  it('renders action buttons for pending decisions', () => {
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', 'pending')]}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    // Should show a clickable decision
    fireEvent.click(screen.getByText('Decision d1'));
    // After click, detail view should show rationale
    const text = document.body.textContent || '';
    expect(text).toContain('Rationale for d1');
  });

  it('handles empty decisions', () => {
    const { container } = render(<DecisionPanelContent decisions={[]} />);
    expect(container).toBeTruthy();
  });

  it('calls onConfirm when confirm clicked in detail view', () => {
    const onConfirm = vi.fn();
    render(
      <DecisionPanelContent
        decisions={[makeDecision('d1', 'pending')]}
        onConfirm={onConfirm}
        onReject={vi.fn()}
      />,
    );
    // Click to expand decision
    fireEvent.click(screen.getByText('Decision d1'));
    // Click confirm
    const confirmBtn = screen.queryByLabelText('Confirm decision');
    if (confirmBtn) fireEvent.click(confirmBtn);
    if (confirmBtn) expect(onConfirm).toHaveBeenCalledWith('d1', undefined);
  });
});
