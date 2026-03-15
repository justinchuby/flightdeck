// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LeadProgressBanner } from '../LeadProgressBanner';
import type { LeadProgress } from '../../../types';

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function makeProgress(overrides: Partial<LeadProgress> = {}): LeadProgress {
  return {
    crewSize: 3,
    active: 2,
    completed: 1,
    failed: 0,
    completionPct: 33,
    totalDelegations: 3,
    crewAgents: [],
    delegations: [],
    ...overrides,
  };
}

describe('LeadProgressBanner', () => {
  it('renders nothing when progress is null', () => {
    const { container } = render(
      <LeadProgressBanner progress={null} progressSummary={null} onShowDetail={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when totalDelegations is 0', () => {
    const { container } = render(
      <LeadProgressBanner
        progress={makeProgress({ totalDelegations: 0 })}
        progressSummary={null}
        onShowDetail={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders agent counts', () => {
    render(
      <LeadProgressBanner progress={makeProgress()} progressSummary={null} onShowDetail={vi.fn()} />,
    );
    expect(screen.getByText('3 agents')).toBeInTheDocument();
    expect(screen.getByText('2 active')).toBeInTheDocument();
    expect(screen.getByText('1 done')).toBeInTheDocument();
  });

  it('shows progress bar width', () => {
    const { container } = render(
      <LeadProgressBanner progress={makeProgress({ completionPct: 60 })} progressSummary={null} onShowDetail={vi.fn()} />,
    );
    const bar = container.querySelector('.bg-green-500');
    expect(bar).toBeInTheDocument();
    expect((bar as HTMLElement).style.width).toBe('60%');
  });

  it('shows failed count when > 0', () => {
    render(
      <LeadProgressBanner progress={makeProgress({ failed: 2 })} progressSummary={null} onShowDetail={vi.fn()} />,
    );
    expect(screen.getByText('2 failed')).toBeInTheDocument();
  });

  it('hides failed when 0', () => {
    render(
      <LeadProgressBanner progress={makeProgress({ failed: 0 })} progressSummary={null} onShowDetail={vi.fn()} />,
    );
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
  });

  it('renders summary text', () => {
    render(
      <LeadProgressBanner progress={makeProgress()} progressSummary="All going well" onShowDetail={vi.fn()} />,
    );
    expect(screen.getByText(/All going well/)).toBeInTheDocument();
  });

  it('clicking calls onShowDetail', () => {
    const onShowDetail = vi.fn();
    render(
      <LeadProgressBanner progress={makeProgress()} progressSummary="Summary" onShowDetail={onShowDetail} />,
    );
    // Click the progress bar area
    fireEvent.click(screen.getByText('3 agents').closest('div')!);
    expect(onShowDetail).toHaveBeenCalled();
  });
});
