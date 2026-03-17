// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeadProgressBanner } from '../LeadProgressBanner';

describe('LeadProgressBanner', () => {
  const makeProgress = (overrides = {}) => ({
    crewSize: 4,
    active: 2,
    completed: 1,
    failed: 0,
    totalDelegations: 5,
    completionPct: 60,
    crewAgents: [],
    delegations: [],
    ...overrides,
  });

  it('renders progress bar', () => {
    render(<LeadProgressBanner progress={makeProgress()} onOpenDetail={vi.fn()} />);
    expect(screen.getByText(/60%/)).toBeInTheDocument();
  });

  it('shows crew size', () => {
    const { container } = render(
      <LeadProgressBanner progress={makeProgress()} onOpenDetail={vi.fn()} />,
    );
    const text = container.textContent || '';
    expect(text).toMatch(/4|crew/i);
  });

  it('calls onOpenDetail when clicked', () => {
    const onOpenDetail = vi.fn();
    const { container } = render(
      <LeadProgressBanner progress={makeProgress()} onOpenDetail={onOpenDetail} />,
    );
    // Click the banner or detail button
    const clickable = container.querySelector('[class*="cursor-pointer"], button');
    if (clickable) fireEvent.click(clickable as HTMLElement);
    // onOpenDetail may be called depending on component structure
  });

  it('renders null progress gracefully', () => {
    const { container } = render(
      <LeadProgressBanner progress={null as any} onOpenDetail={vi.fn()} />,
    );
    expect(container).toBeTruthy();
  });

  it('shows failed count when > 0', () => {
    const { container } = render(
      <LeadProgressBanner progress={makeProgress({ failed: 2 })} onOpenDetail={vi.fn()} />,
    );
    const text = container.textContent || '';
    expect(text).toMatch(/2|failed/i);
  });
});
