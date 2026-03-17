import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityFeedItem, ACTIVITY_ICONS } from '../ActivityFeedItem';
import type { ActivityEntry } from '../ActivityFeedItem';

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: (ts: string) => `relative(${ts})`,
}));

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 1,
    agentId: 'agent-1',
    agentRole: 'developer',
    actionType: 'task_completed',
    summary: 'Implemented user auth',
    timestamp: '2025-01-15T10:30:00Z',
    projectId: 'proj-1',
    ...overrides,
  };
}

describe('ActivityFeedItem', () => {
  it('renders summary and metadata', () => {
    render(
      <ActivityFeedItem entry={makeEntry()} projectName="MyProject" />,
    );
    expect(screen.getByText('Implemented user auth')).toBeTruthy();
    expect(screen.getByText(/developer/)).toBeTruthy();
    expect(screen.getByText(/MyProject/)).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <ActivityFeedItem entry={makeEntry()} projectName="P" onClick={onClick} />,
    );
    fireEvent.click(screen.getByTestId('activity-feed-item'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders without onClick (no crash)', () => {
    render(
      <ActivityFeedItem entry={makeEntry()} projectName="P" />,
    );
    expect(screen.getByTestId('activity-feed-item')).toBeTruthy();
  });

  it('uses fallback icon for unknown action type', () => {
    render(
      <ActivityFeedItem entry={makeEntry({ actionType: 'unknown_type' })} projectName="P" />,
    );
    // Should render fallback emoji '📎'
    expect(screen.getByText('📎')).toBeTruthy();
  });

  it('exports ACTIVITY_ICONS with expected keys', () => {
    expect(ACTIVITY_ICONS).toHaveProperty('progress_update');
    expect(ACTIVITY_ICONS).toHaveProperty('task_completed');
    expect(ACTIVITY_ICONS).toHaveProperty('delegated');
  });
});
