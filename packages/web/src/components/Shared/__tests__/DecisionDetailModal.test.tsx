import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionDetailModal } from '../DecisionDetailModal';
import type { Decision } from '../../../types';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('../DecisionFeedItem', () => ({
  DECISION_CATEGORY_ICONS: {
    architecture: '🏗️',
    dependency: '📦',
    style: '🎨',
    tool_access: '🔧',
    testing: '🧪',
    general: '💡',
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    title: 'Use TypeScript strict mode',
    category: 'style',
    status: 'confirmed',
    agentRole: 'architect',
    rationale: 'Improves type safety across the project',
    timestamp: '2025-01-15T10:30:00Z',
    projectId: 'proj-1',
    agentId: 'agent-1',
    needsConfirmation: false,
    autoApproved: false,
    confirmedAt: null,
    ...overrides,
  } as Decision;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('DecisionDetailModal', () => {
  it('renders modal with decision title', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Use TypeScript strict mode')).toBeTruthy();
  });

  it('displays category icon', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ category: 'architecture' })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('🏗️')).toBeTruthy();
  });

  it('shows decision rationale', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Improves type safety across the project')).toBeTruthy();
  });

  it('hides rationale section when not provided', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ rationale: undefined })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Rationale')).toBeNull();
  });

  it('displays status label', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ status: 'confirmed' })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('displays rejected status', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ status: 'rejected' })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Rejected')).toBeTruthy();
  });

  it('shows category label', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ category: 'architecture' })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Architecture')).toBeTruthy();
  });

  it('shows agent role', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('architect')).toBeTruthy();
  });

  it('shows project name', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Project')).toBeTruthy();
  });

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn();
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking backdrop', () => {
    const onClose = vi.fn();
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={onClose}
      />,
    );
    const backdrop = screen.getByTestId('decision-detail-modal');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside modal', () => {
    const onClose = vi.fn();
    render(
      <DecisionDetailModal
        decision={makeDecision()}
        projectName="Test Project"
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(screen.getByText('Decision Detail'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows auto-approved flag', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ autoApproved: true })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('✓ Auto-approved')).toBeTruthy();
  });

  it('shows needs confirmation flag', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ needsConfirmation: true })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('⚠ Requires confirmation')).toBeTruthy();
  });

  it('shows confirmedAt when provided', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ confirmedAt: '2025-01-16T10:00:00Z' })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Confirmed At')).toBeTruthy();
  });

  it('falls back to "Recorded" for unknown status', () => {
    render(
      <DecisionDetailModal
        decision={makeDecision({ status: 'unknown_status' as any })}
        projectName="Test Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Recorded')).toBeTruthy();
  });
});
