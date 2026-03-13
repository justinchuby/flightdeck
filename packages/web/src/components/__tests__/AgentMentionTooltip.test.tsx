/**
 * Unit tests for AgentMentionTooltip and MentionText with tooltips.
 *
 * Covers: tooltip hover delay (200ms), tooltip content (role, status, model, task),
 * tooltip dismiss on mouse leave, truncation of long tasks, MentionText integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AgentMentionTooltip, type MentionAgent } from '../AgentMentionTooltip';
import { MentionText } from '../../utils/markdown';

const baseAgent: MentionAgent = {
  id: 'a1b2c3d4e5f6',
  role: { name: 'Developer', icon: '💻', id: 'developer' },
  status: 'running',
  task: 'Implement auth module',
  model: 'claude-sonnet-4',
};

describe('AgentMentionTooltip', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('does not show tooltip initially', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    expect(screen.queryByTestId('mention-tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip after 200ms hover delay', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    // Before 200ms — no tooltip
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByTestId('mention-tooltip')).not.toBeInTheDocument();
    // After 200ms — tooltip visible
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByTestId('mention-tooltip')).toBeInTheDocument();
  });

  it('hides tooltip on mouse leave before delay', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    const container = screen.getByText('@dev').parentElement!;
    fireEvent.mouseEnter(container);
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.mouseLeave(container);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByTestId('mention-tooltip')).not.toBeInTheDocument();
  });

  it('hides tooltip on mouse leave after showing', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    const container = screen.getByText('@dev').parentElement!;
    fireEvent.mouseEnter(container);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('mention-tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(container);
    expect(screen.queryByTestId('mention-tooltip')).not.toBeInTheDocument();
  });

  it('displays role name, icon, and short ID', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('💻')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument();
  });

  it('displays status and model', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  });

  it('displays current task', () => {
    render(
      <AgentMentionTooltip agent={baseAgent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('Implement auth module')).toBeInTheDocument();
  });

  it('truncates long task text at 80 chars', () => {
    const longTask = 'A'.repeat(100);
    const agent = { ...baseAgent, task: longTask };
    render(
      <AgentMentionTooltip agent={agent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('A'.repeat(80) + '…')).toBeInTheDocument();
  });

  it('omits task section when no task', () => {
    const agent = { ...baseAgent, task: undefined };
    render(
      <AgentMentionTooltip agent={agent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    const tooltip = screen.getByTestId('mention-tooltip');
    expect(tooltip.textContent).not.toContain('Implement');
  });

  it('omits model when not provided', () => {
    const agent = { ...baseAgent, model: undefined };
    render(
      <AgentMentionTooltip agent={agent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    const tooltip = screen.getByTestId('mention-tooltip');
    expect(tooltip.textContent).not.toContain('claude');
  });

  it('shows unknown for missing status', () => {
    const agent = { ...baseAgent, status: undefined };
    render(
      <AgentMentionTooltip agent={agent}>
        <span>@dev</span>
      </AgentMentionTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('@dev').parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});

describe('MentionText with tooltips', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders @mention with tooltip wrapper', () => {
    const agents = [baseAgent];
    render(<MentionText text="Hey @a1b2c3d4 check this" agents={agents} />);
    const mention = screen.getByText(/@developer/);
    expect(mention).toBeInTheDocument();
    // Hover to show tooltip
    fireEvent.mouseEnter(mention.parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('mention-tooltip')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('renders plain text without mentions unchanged', () => {
    render(<MentionText text="No mentions here" agents={[baseAgent]} />);
    expect(screen.getByText('No mentions here')).toBeInTheDocument();
    expect(screen.queryByTestId('mention-tooltip')).not.toBeInTheDocument();
  });

  it('handles multiple mentions', () => {
    const agents: MentionAgent[] = [
      baseAgent,
      { id: 'f0f0f0f0abcd', role: { name: 'Architect', icon: '🏗️' }, status: 'idle' },
    ];
    render(<MentionText text="@a1b2c3d4 and @f0f0f0f0" agents={agents} />);
    expect(screen.getByText(/@developer/)).toBeInTheDocument();
    expect(screen.getByText(/@architect/)).toBeInTheDocument();
  });

  it('resolves @role-name mentions by role id', () => {
    const agents = [baseAgent];
    render(<MentionText text="Hey @developer check this" agents={agents} />);
    expect(screen.getByText(/@developer/)).toBeInTheDocument();
  });

  it('resolves @role-name mentions by role name (case-insensitive)', () => {
    const agents: MentionAgent[] = [
      { id: 'abc123def456', role: { name: 'Code Reviewer', icon: '🔍', id: 'code-reviewer' }, status: 'running' },
    ];
    render(<MentionText text="Ask @code-reviewer for feedback" agents={agents} />);
    expect(screen.getByText(/@code reviewer/)).toBeInTheDocument();
  });

  it('resolves hyphenated role name from display name', () => {
    const agents: MentionAgent[] = [
      { id: 'abc123def456', role: { name: 'QA Tester', icon: '🧪' }, status: 'idle' },
    ];
    render(<MentionText text="@qa-tester please verify" agents={agents} />);
    expect(screen.getByText(/@qa tester/)).toBeInTheDocument();
  });

  it('prefers hex ID match over role name match', () => {
    const agents: MentionAgent[] = [
      { id: 'abcdef12face', role: { name: 'Developer', icon: '💻', id: 'developer' }, status: 'running', task: 'Task A' },
      { id: 'fedcba98face', role: { name: 'Developer', icon: '💻', id: 'developer' }, status: 'idle', task: 'Task B' },
    ];
    render(<MentionText text="@fedcba98 is idle" agents={agents} />);
    // Should show tooltip for the second agent (matched by hex ID), not the first
    const mention = screen.getByText(/@developer/);
    fireEvent.mouseEnter(mention.parentElement!);
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('fedcba98')).toBeInTheDocument();
  });

  it('ignores @mentions that match no agent', () => {
    render(<MentionText text="Hey @nobody check this" agents={[baseAgent]} />);
    // No mention badge rendered — text appears as plain
    expect(screen.queryByTestId('mention-tooltip')).not.toBeInTheDocument();
    expect(screen.getByText(/Hey @nobody check this/)).toBeInTheDocument();
  });
});
