// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MilestoneTimeline } from '../MilestoneTimeline';

const makeKeyframe = (overrides: Record<string, unknown> = {}) => ({
  timestamp: '2024-01-15T10:30:00Z',
  label: 'Task completed',
  type: 'milestone' as const,
  agentId: 'a1',
  ...overrides,
});

describe('MilestoneTimeline', () => {
  it('renders milestone keyframes', () => {
    render(<MilestoneTimeline keyframes={[makeKeyframe()]} />);
    expect(screen.getByText(/Task completed/)).toBeInTheDocument();
  });

  it('filters to milestone-relevant types', () => {
    const keyframes = [
      makeKeyframe({ type: 'milestone', label: 'Phase 1 done' }),
      makeKeyframe({ type: 'spawn', label: 'Agent spawned' }),
      makeKeyframe({ type: 'task', label: 'Task started' }),
      makeKeyframe({ type: 'decision', label: 'Decision made' }),
    ];
    render(<MilestoneTimeline keyframes={keyframes} />);
    expect(screen.getByText(/Phase 1 done/)).toBeInTheDocument();
    expect(screen.getByText(/Task started/)).toBeInTheDocument();
    expect(screen.getByText(/Decision made/)).toBeInTheDocument();
  });

  it('calls onSeek when milestone clicked', () => {
    const onSeek = vi.fn();
    render(<MilestoneTimeline keyframes={[makeKeyframe({ timestamp: '2024-01-15T10:00:00Z' })]} onSeek={onSeek} />);
    const milestone = screen.getByText(/Task completed/);
    fireEvent.click(milestone);
    expect(onSeek).toHaveBeenCalledWith('2024-01-15T10:00:00Z');
  });

  it('renders empty state with no keyframes', () => {
    const { container } = render(<MilestoneTimeline keyframes={[]} />);
    expect(container).toBeTruthy();
  });

  it('handles error and commit types', () => {
    const keyframes = [
      makeKeyframe({ type: 'error', label: 'Build failed' }),
      makeKeyframe({ type: 'commit', label: 'Code committed' }),
    ];
    render(<MilestoneTimeline keyframes={keyframes} />);
    expect(screen.getByText(/Build failed/)).toBeInTheDocument();
    expect(screen.getByText(/Code committed/)).toBeInTheDocument();
  });

  it('does not call onSeek when not provided', () => {
    render(<MilestoneTimeline keyframes={[makeKeyframe()]} />);
    const milestone = screen.getByText(/Task completed/);
    // Should not crash when clicking without onSeek
    fireEvent.click(milestone);
  });
});
