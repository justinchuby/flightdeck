// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PostSessionRetroCard } from '../PostSessionRetroCard';
import type { SessionSummary } from '../types';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    leadId: 'aaaa-bbbb-cccc-dddd',
    projectId: 'my-project',
    status: 'completed',
    startedAt: '2024-06-01T10:00:00Z',
    endedAt: '2024-06-01T11:30:00Z',
    agentCount: 4,
    taskCount: 12,
    totalInputTokens: 50000,
    totalOutputTokens: 30000,
    ...overrides,
  };
}

describe('PostSessionRetroCard', () => {
  const onClose = vi.fn();

  it('renders with test id', () => {
    render(<PostSessionRetroCard session={makeSession()} avgTasks={10} onClose={onClose} />);
    expect(screen.getByTestId('post-session-retro')).toBeInTheDocument();
  });

  it('displays project id in the header', () => {
    render(<PostSessionRetroCard session={makeSession()} avgTasks={10} onClose={onClose} />);
    expect(screen.getByText(/my-project/)).toBeInTheDocument();
  });

  it('falls back to short agent id when no projectId', () => {
    render(<PostSessionRetroCard session={makeSession({ projectId: null })} avgTasks={10} onClose={onClose} />);
    // shortAgentId('aaaa-bbbb-cccc-dddd') → 'aaaa-bbb' (8 chars)
    expect(screen.getByText(/aaaa-bbb/)).toBeInTheDocument();
  });

  it('displays duration, tokens, task and agent counts', () => {
    render(<PostSessionRetroCard session={makeSession()} avgTasks={10} onClose={onClose} />);
    expect(screen.getByText(/Duration: 90m/)).toBeInTheDocument();
    expect(screen.getByText(/Tokens: 80k/)).toBeInTheDocument();
    expect(screen.getByText(/Tasks: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Agents: 4/)).toBeInTheDocument();
  });

  it('shows above-average indicator when tasks exceed average', () => {
    render(<PostSessionRetroCard session={makeSession({ taskCount: 15 })} avgTasks={10} onClose={onClose} />);
    expect(screen.getByText(/50% above average/)).toBeInTheDocument();
  });

  it('shows below-average indicator when tasks are below average', () => {
    render(<PostSessionRetroCard session={makeSession({ taskCount: 5 })} avgTasks={10} onClose={onClose} />);
    expect(screen.getByText(/50% below average/)).toBeInTheDocument();
  });

  it('does not render delta indicator when avgTasks is zero', () => {
    render(<PostSessionRetroCard session={makeSession()} avgTasks={0} onClose={onClose} />);
    // DeltaIndicator returns null when average is 0, so no percentage text
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', () => {
    render(<PostSessionRetroCard session={makeSession()} avgTasks={10} onClose={onClose} />);
    const closeButtons = screen.getAllByText('Close');
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('displays 0m duration when endedAt is null', () => {
    render(<PostSessionRetroCard session={makeSession({ endedAt: null })} avgTasks={10} onClose={onClose} />);
    expect(screen.getByText(/Duration: 0m/)).toBeInTheDocument();
  });
});
