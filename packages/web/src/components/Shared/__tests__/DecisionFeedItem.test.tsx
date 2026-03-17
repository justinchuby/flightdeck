import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionFeedItem, DECISION_CATEGORY_ICONS } from '../DecisionFeedItem';
import type { Decision } from '../../../types';

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: (ts: string) => `relative(${ts})`,
}));

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    title: 'Use TypeScript strict mode',
    category: 'architecture',
    status: 'confirmed',
    agentRole: 'architect',
    rationale: 'Improves type safety',
    timestamp: '2025-01-15T10:30:00Z',
    projectId: 'proj-1',
    agentId: 'agent-1',
    needsConfirmation: false,
    autoApproved: false,
    confirmedAt: null,
    ...overrides,
  } as Decision;
}

describe('DecisionFeedItem', () => {
  it('renders decision title and metadata', () => {
    render(
      <DecisionFeedItem decision={makeDecision()} projectName="TestProj" />,
    );
    expect(screen.getByText('Use TypeScript strict mode')).toBeTruthy();
    expect(screen.getByText(/architect/)).toBeTruthy();
    expect(screen.getByText(/TestProj/)).toBeTruthy();
  });

  it('renders confirmed status icon (green check)', () => {
    const { container } = render(
      <DecisionFeedItem decision={makeDecision({ status: 'confirmed' })} projectName="P" />,
    );
    expect(container.querySelector('.text-green-400')).toBeTruthy();
  });

  it('renders rejected status icon (red)', () => {
    const { container } = render(
      <DecisionFeedItem decision={makeDecision({ status: 'rejected' })} projectName="P" />,
    );
    expect(container.querySelector('.text-red-400')).toBeTruthy();
  });

  it('renders pending status for unknown status values', () => {
    const { container } = render(
      <DecisionFeedItem decision={makeDecision({ status: 'recorded' as any })} projectName="P" />,
    );
    expect(container.querySelector('.text-th-text-muted')).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <DecisionFeedItem decision={makeDecision()} projectName="P" onClick={onClick} />,
    );
    fireEvent.click(screen.getByTestId('decision-feed-item'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('exports DECISION_CATEGORY_ICONS with expected keys', () => {
    expect(DECISION_CATEGORY_ICONS).toHaveProperty('architecture');
    expect(DECISION_CATEGORY_ICONS).toHaveProperty('dependency');
    expect(DECISION_CATEGORY_ICONS).toHaveProperty('testing');
  });
});
