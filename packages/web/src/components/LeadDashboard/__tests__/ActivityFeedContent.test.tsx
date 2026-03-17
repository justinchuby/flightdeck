// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActivityFeedContent } from '../ActivityFeedContent';
import type { ActivityEvent } from '../../../stores/leadStore';
import type { AgentInfo } from '../../../types';

vi.mock('../../Shared', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function makeEvent(overrides: Partial<ActivityEvent> & { id: string }): ActivityEvent {
  return {
    agentId: 'agent-abc12345',
    agentRole: 'developer',
    type: 'delegation',
    summary: 'Did a thing',
    timestamp: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

const defaultAgents: AgentInfo[] = [
  {
    id: 'agent-abc12345',
    role: { id: 'dev', name: 'Developer', icon: '💻', instructions: '' },
    status: 'running',
    childIds: [],
    createdAt: '2024-01-01',
    outputPreview: '',
    model: 'claude-sonnet-4',
  } as AgentInfo,
];

describe('ActivityFeedContent', () => {
  it('renders empty state when no activity', () => {
    render(<ActivityFeedContent activity={[]} agents={[]} />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No activity yet');
  });

  it('renders activity events with icons', () => {
    const events = [
      makeEvent({ id: '1', type: 'delegation', summary: 'Delegated task' }),
      makeEvent({ id: '2', type: 'completion', summary: 'Task done' }),
      makeEvent({ id: '3', type: 'message_sent', summary: 'Sent msg' }),
    ];
    render(<ActivityFeedContent activity={events} agents={defaultAgents} />);
    expect(screen.getByText('Delegated task')).toBeInTheDocument();
    expect(screen.getByText('Task done')).toBeInTheDocument();
    expect(screen.getByText('Sent msg')).toBeInTheDocument();
  });

  it('shows agent role name from agents list', () => {
    const events = [makeEvent({ id: '1' })];
    render(<ActivityFeedContent activity={events} agents={defaultAgents} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('limits to last 30 events', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, summary: `Event ${i}` }),
    );
    const { container } = render(<ActivityFeedContent activity={events} agents={defaultAgents} />);
    // Should show events 10-39 (last 30), not events 0-9
    expect(screen.queryByText('Event 0')).not.toBeInTheDocument();
    expect(screen.getByText('Event 39')).toBeInTheDocument();
    // Count rendered event rows
    const rows = container.querySelectorAll('.cv-auto-sm');
    expect(rows.length).toBe(30);
  });

  it('shows timestamp', () => {
    const events = [makeEvent({ id: '1', timestamp: '2024-01-15T10:30:00Z' })];
    render(<ActivityFeedContent activity={events} agents={defaultAgents} />);
    // toLocaleTimeString output depends on locale but should contain time digits
    const timeEl = screen.getByText((_, el) =>
      el?.tagName === 'SPAN' && /\d{1,2}:\d{2}/.test(el.textContent || ''),
    );
    expect(timeEl).toBeInTheDocument();
  });

  it('falls back to agentRole when agent not found in list', () => {
    const events = [makeEvent({ id: '1', agentId: 'unknown', agentRole: 'tester' })];
    render(<ActivityFeedContent activity={events} agents={defaultAgents} />);
    expect(screen.getByText('tester')).toBeInTheDocument();
  });
});
