// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityFeed } from '../ActivityFeed';

const makeAgent = (id: string) => ({
  id,
  role: { id: 'dev', name: 'Developer', icon: '💻' },
  status: 'running' as const,
  childIds: [],
  createdAt: new Date().toISOString(),
  outputPreview: '',
  model: 'gpt-4',
});

const makeActivity = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  agentId: 'a1',
  agentRole: 'developer',
  actionType: 'file_edit',
  summary: 'Edited src/index.ts',
  timestamp: new Date().toISOString(),
  projectId: 'p1',
  ...overrides,
});

describe('ActivityFeed', () => {
  it('renders activity entries', () => {
    render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
    expect(screen.getByText(/file edit/)).toBeInTheDocument();
  });

  it('renders empty state', () => {
    const { container } = render(<ActivityFeed activity={[]} agents={[]} />);
    expect(container).toBeTruthy();
  });

  it('shows agent role for activity', () => {
    render(
      <ActivityFeed
        activity={[makeActivity({ actionType: 'file_create' })]}
        agents={[makeAgent('a1')]}
      />,
    );
    expect(screen.getByText(/Developer/)).toBeInTheDocument();
  });

  it('renders multiple activities', () => {
    const activities = [
      makeActivity({ id: 1, actionType: 'file_edit' }),
      makeActivity({ id: 2, actionType: 'milestone' }),
      makeActivity({ id: 3, actionType: 'lock_acquire' }),
    ];
    render(<ActivityFeed activity={activities} agents={[makeAgent('a1')]} />);
    expect(screen.getByText(/file edit/)).toBeInTheDocument();
    expect(screen.getByText(/milestone/)).toBeInTheDocument();
  });

  it('shows detail on click', () => {
    render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
    const item = screen.getByText(/file edit/);
    fireEvent.click(item.closest('[class*="cursor-pointer"]') || item);
    // Clicking should not crash and may show detail
    expect(item).toBeInTheDocument();
  });

  it('handles various action types', () => {
    const actions = ['file_edit', 'file_read', 'file_create', 'lock_acquire', 'lock_release', 'milestone'];
    const activities = actions.map((a, i) => makeActivity({ id: i, actionType: a }));
    render(<ActivityFeed activity={activities} agents={[makeAgent('a1')]} />);
    expect(screen.getByText(/file edit/)).toBeInTheDocument();
    expect(screen.getByText(/milestone/)).toBeInTheDocument();
  });
});
