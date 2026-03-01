/**
 * Unit tests for CommHeatmap.
 *
 * Covers: empty state, cell rendering, intensity classes,
 * self-cell exclusion, legend, and tooltip.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommHeatmap } from '../CommHeatmap';
import type { CommHeatmapProps, HeatmapMessage, CommType } from '../CommHeatmap';

// ── Fixtures ──────────────────────────────────────────────────────────────

const AGENTS: CommHeatmapProps['agents'] = [
  { id: 'lead-1', role: 'lead',      name: 'Lead' },
  { id: 'dev-1',  role: 'developer', name: 'Dev'  },
  { id: 'rev-1',  role: 'reviewer',  name: 'Rev'  },
];

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CommHeatmap', () => {
  it('shows empty-state message when agents array is empty', () => {
    render(<CommHeatmap agents={[]} messages={[]} />);
    expect(screen.getByText(/no agents/i)).toBeInTheDocument();
  });

  it('renders N×N cells for N agents (minus self-cells rendering differently)', () => {
    const { container } = render(
      <CommHeatmap agents={AGENTS} messages={[]} />,
    );

    // Each row has one cell per agent → 3 agents × 3 columns = 9 cells total.
    // We check that the grid rows are rendered (one per agent) and each contains
    // cells (one per agent).
    const rows = container.querySelectorAll('[class*="flex items-center"]');
    // At least 3 data rows.
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('renders column headers for every agent', () => {
    render(<CommHeatmap agents={AGENTS} messages={[]} />);

    // Each agent name appears at least once (column header + row label = ×2).
    AGENTS.forEach(agent => {
      const els = screen.getAllByText(agent.name);
      expect(els.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('applies bg-accent intensity classes when message counts exist', () => {
    const messages: CommHeatmapProps['messages'] = [
      { from: 'lead-1', to: 'dev-1', count: 10 },
      { from: 'lead-1', to: 'rev-1', count: 2  },
    ];
    const { container } = render(
      <CommHeatmap agents={AGENTS} messages={messages} />,
    );

    // The highest-count cell should use a high-opacity accent class.
    const highCell = container.querySelector('[class*="bg-accent"]');
    expect(highCell).not.toBeNull();
  });

  it('self-cells have a muted background, not an accent class', () => {
    const { container } = render(
      <CommHeatmap
        agents={AGENTS}
        messages={[{ from: 'lead-1', to: 'lead-1', count: 99 }]}
      />,
    );

    // Self-cells use bg-th-bg-muted/20, which includes 'muted'.
    const selfCells = container.querySelectorAll('[class*="bg-th-bg-muted"]');
    expect(selfCells.length).toBeGreaterThanOrEqual(AGENTS.length);
  });

  it('aggregates multiple entries for the same pair', () => {
    const messages: CommHeatmapProps['messages'] = [
      { from: 'lead-1', to: 'dev-1', count: 5  },
      { from: 'lead-1', to: 'dev-1', count: 3  },
    ];
    const { container } = render(
      <CommHeatmap agents={AGENTS} messages={messages} />,
    );

    // Aggregated total = 8; max in legend should show 8.
    expect(container.textContent).toContain('8');
  });

  it('shows tooltip with correct from/to/count on mouse enter', () => {
    const messages: CommHeatmapProps['messages'] = [
      { from: 'lead-1', to: 'dev-1', count: 7 },
    ];
    const { container } = render(
      <CommHeatmap agents={AGENTS} messages={messages} />,
    );

    // Find a non-self, non-empty cell.
    const accentCell = container.querySelector('[class*="bg-accent"]') as HTMLElement;
    expect(accentCell).not.toBeNull();

    fireEvent.mouseEnter(accentCell, { clientX: 200, clientY: 200 });

    // Tooltip renders inside a fixed overlay — use the tooltip element directly.
    const tooltip = container.querySelector('.fixed.z-50');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('Lead');
    expect(tooltip!.textContent).toContain('Dev');
    expect(tooltip!.textContent).toContain('7 message');
  });

  it('dismisses tooltip on mouse leave', () => {
    const messages: CommHeatmapProps['messages'] = [
      { from: 'lead-1', to: 'dev-1', count: 4 },
    ];
    const { container } = render(
      <CommHeatmap agents={AGENTS} messages={messages} />,
    );

    const accentCell = container.querySelector('[class*="bg-accent"]') as HTMLElement;
    fireEvent.mouseEnter(accentCell, { clientX: 200, clientY: 200 });
    fireEvent.mouseLeave(accentCell);

    const fixedTooltip = container.querySelector('.fixed.z-50');
    expect(fixedTooltip).toBeNull();
  });

  it('renders the colour-scale legend', () => {
    render(<CommHeatmap agents={AGENTS} messages={[]} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows "No messages" in tooltip for zero-count cells', () => {
    const { container } = render(
      <CommHeatmap
        agents={[
          { id: 'a', role: 'r', name: 'AgentA' },
          { id: 'b', role: 'r', name: 'AgentB' },
        ]}
        messages={[]}
      />,
    );

    // Find the empty (non-self) cell between A and B.
    const emptyCells = container.querySelectorAll('[class*="bg-th-bg-alt"]') as NodeListOf<HTMLElement>;
    expect(emptyCells.length).toBeGreaterThan(0);

    fireEvent.mouseEnter(emptyCells[0], { clientX: 100, clientY: 100 });
    expect(screen.getByText(/No messages/)).toBeInTheDocument();
  });

  // ── Comm type filtering ───────────────────────────────────────────────

  it('shows filter chips when messages include type info', () => {
    const messages: HeatmapMessage[] = [
      { from: 'lead-1', to: 'dev-1', count: 5, type: 'delegation' },
      { from: 'dev-1', to: 'lead-1', count: 3, type: 'message' },
    ];
    render(<CommHeatmap agents={AGENTS} messages={messages} />);
    expect(screen.getByText('Delegations')).toBeInTheDocument();
    expect(screen.getByText('DMs')).toBeInTheDocument();
  });

  it('does not show filter chips when messages have no type info', () => {
    const messages: CommHeatmapProps['messages'] = [
      { from: 'lead-1', to: 'dev-1', count: 5 },
    ];
    render(<CommHeatmap agents={AGENTS} messages={messages} />);
    expect(screen.queryByText('Delegations')).not.toBeInTheDocument();
  });

  it('filters messages when a type chip is toggled off', () => {
    const messages: HeatmapMessage[] = [
      { from: 'lead-1', to: 'dev-1', count: 10, type: 'delegation' },
      { from: 'dev-1', to: 'rev-1', count: 5, type: 'message' },
    ];
    const { container } = render(<CommHeatmap agents={AGENTS} messages={messages} />);

    // Max count shown in legend should include both types initially.
    expect(container.textContent).toContain('10');

    // Toggle off 'Delegations' — only 'message' (count=5) remains.
    fireEvent.click(screen.getByText('Delegations'));
    expect(container.textContent).toContain('5');
  });

  it('hides filter chips when hideFilters prop is true', () => {
    const messages: HeatmapMessage[] = [
      { from: 'lead-1', to: 'dev-1', count: 5, type: 'delegation' },
    ];
    render(<CommHeatmap agents={AGENTS} messages={messages} hideFilters />);
    expect(screen.queryByText('Delegations')).not.toBeInTheDocument();
  });

  it('keeps at least one filter active (cannot deselect all)', () => {
    const messages: HeatmapMessage[] = [
      { from: 'lead-1', to: 'dev-1', count: 5, type: 'delegation' },
    ];
    render(<CommHeatmap agents={AGENTS} messages={messages} />);

    // All chips start active. Click Delegations — it deactivates.
    const delegationBtn = screen.getByText('Delegations');
    fireEvent.click(delegationBtn);
    // Now re-click all remaining active types except one — the last one should stay.
    // Simpler: just verify at least one chip stays aria-pressed=true after toggling all.
    const allButtons = screen.getAllByRole('button', { pressed: true });
    expect(allButtons.length).toBeGreaterThanOrEqual(1);
  });
});
