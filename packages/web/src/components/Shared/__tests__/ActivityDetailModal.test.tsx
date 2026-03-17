import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityDetailModal } from '../ActivityDetailModal';
import type { ActivityEntry } from '../ActivityFeedItem';

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<object>('lucide-react');
  return { ...actual };
});

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 1,
    agentId: 'agent-1',
    agentRole: 'developer',
    actionType: 'task_completed',
    summary: 'Finished writing tests',
    timestamp: '2025-01-15T10:30:00Z',
    projectId: 'proj-1',
    ...overrides,
  };
}

describe('ActivityDetailModal', () => {
  it('renders modal with entry details', () => {
    render(
      <ActivityDetailModal
        entry={makeEntry()}
        projectName="My Project"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Activity Detail')).toBeTruthy();
    expect(screen.getByText('Finished writing tests')).toBeTruthy();
    expect(screen.getByText('Task Completed')).toBeTruthy();
    expect(screen.getByText('developer')).toBeTruthy();
    expect(screen.getByText('My Project')).toBeTruthy();
  });

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn();
    render(
      <ActivityDetailModal entry={makeEntry()} projectName="P" onClose={onClose} />,
    );
    // The X button is inside the header
    const closeBtn = screen.getByTestId('activity-detail-modal').querySelector('button');
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <ActivityDetailModal entry={makeEntry()} projectName="P" onClose={onClose} />,
    );
    fireEvent.mouseDown(screen.getByTestId('activity-detail-modal'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(
      <ActivityDetailModal entry={makeEntry()} projectName="P" onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('falls back to actionType when type label is unknown', () => {
    render(
      <ActivityDetailModal
        entry={makeEntry({ actionType: 'custom_action' })}
        projectName="P"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('custom_action')).toBeTruthy();
  });
});
