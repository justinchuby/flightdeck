// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseDiffSummary = vi.fn();
vi.mock('../../../hooks/useFocusAgent', () => ({
  useDiffSummary: (...args: unknown[]) => mockUseDiffSummary(...args),
}));

import { DiffBadge } from '../DiffBadge';

describe('DiffBadge', () => {
  it('renders nothing when no summary', () => {
    mockUseDiffSummary.mockReturnValue({ summary: null });
    const { container } = render(<DiffBadge agentId="a1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when filesChanged is 0', () => {
    mockUseDiffSummary.mockReturnValue({ summary: { filesChanged: 0, additions: 0, deletions: 0 } });
    const { container } = render(<DiffBadge agentId="a1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders badge with file count', () => {
    mockUseDiffSummary.mockReturnValue({ summary: { filesChanged: 3, additions: 50, deletions: 10 } });
    render(<DiffBadge agentId="a1" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('shows additions only', () => {
    mockUseDiffSummary.mockReturnValue({ summary: { filesChanged: 1, additions: 20, deletions: 0 } });
    render(<DiffBadge agentId="a1" />);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('calls onClick when clicked', () => {
    mockUseDiffSummary.mockReturnValue({ summary: { filesChanged: 2, additions: 5, deletions: 3 } });
    const onClick = vi.fn();
    render(<DiffBadge agentId="a1" onClick={onClick} />);
    fireEvent.click(screen.getByTitle(/2 files changed/));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows singular file text', () => {
    mockUseDiffSummary.mockReturnValue({ summary: { filesChanged: 1, additions: 1, deletions: 0 } });
    render(<DiffBadge agentId="a1" />);
    expect(screen.getByTitle('1 file changed')).toBeInTheDocument();
  });
});
