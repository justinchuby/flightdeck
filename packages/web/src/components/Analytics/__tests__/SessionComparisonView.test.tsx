import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionComparisonView } from '../SessionComparisonView';
import type { SessionComparison } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makeComparison(overrides: Partial<SessionComparison> = {}): SessionComparison {
  return {
    sessions: [
      {
        leadId: 'lead-aaa-111',
        projectId: 'Project Alpha',
        status: 'completed',
        startedAt: '2025-01-01T00:00:00Z',
        endedAt: '2025-01-01T01:00:00Z',
        agentCount: 5,
        taskCount: 10,
        totalInputTokens: 5000,
        totalOutputTokens: 3000,
      },
      {
        leadId: 'lead-bbb-222',
        projectId: 'Project Beta',
        status: 'completed',
        startedAt: '2025-01-02T00:00:00Z',
        endedAt: '2025-01-02T01:00:00Z',
        agentCount: 3,
        taskCount: 8,
        totalInputTokens: 4000,
        totalOutputTokens: 2000,
      },
    ],
    deltas: { tokenDelta: 10, agentCountDelta: 2 },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('SessionComparisonView', () => {
  it('renders comparison table', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    expect(screen.getByTestId('session-comparison')).toBeTruthy();
    expect(screen.getByText('📊 Compare Sessions')).toBeTruthy();
  });

  it('shows session project IDs as column headers', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    expect(screen.getByText('Project Alpha')).toBeTruthy();
    expect(screen.getByText('Project Beta')).toBeTruthy();
  });

  it('falls back to short leadId when projectId is null', () => {
    const comp = makeComparison();
    comp.sessions[0].projectId = null;
    render(<SessionComparisonView comparison={comp} onClose={vi.fn()} />);
    expect(screen.getByText('lead-aaa')).toBeTruthy();
  });

  it('displays token comparison row', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    expect(screen.getByText('Tokens')).toBeTruthy();
    // Session A: 5000+3000 = 8000
    expect(screen.getByText('8,000')).toBeTruthy();
    // Session B: 4000+2000 = 6000
    expect(screen.getByText('6,000')).toBeTruthy();
  });

  it('displays agent count comparison', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('displays task count comparison', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('shows delta values with correct signs', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    // Token delta: (8000-6000)/6000 * 100 = 33.3%, shown as +33.3%
    expect(screen.getByText('+33.3%')).toBeTruthy();
    // Agent delta: 5-3 = +2.0, Task delta: 10-8 = +2.0
    const deltaCells = screen.getAllByText('+2.0');
    expect(deltaCells.length).toBe(2);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SessionComparisonView comparison={makeComparison()} onClose={onClose} />);
    fireEvent.click(screen.getByText('✕ Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('returns null when sessions array is incomplete', () => {
    const comp = makeComparison();
    comp.sessions = [comp.sessions[0]] as any;
    const { container } = render(<SessionComparisonView comparison={comp} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('applies correct color for lower-is-better metrics (tokens)', () => {
    // Token delta > 0 means A uses MORE tokens — that's bad for lower-is-better
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    // The delta cell for tokens should have red color (more tokens = bad)
    const tokenRow = screen.getByText('Tokens').closest('tr')!;
    const deltaCells = tokenRow.querySelectorAll('td');
    const deltaCell = deltaCells[deltaCells.length - 1];
    expect(deltaCell.className).toContain('text-red-400');
  });

  it('shows metric labels', () => {
    render(<SessionComparisonView comparison={makeComparison()} onClose={vi.fn()} />);
    expect(screen.getByText('Metric')).toBeTruthy();
    expect(screen.getByText('Delta')).toBeTruthy();
  });
});
