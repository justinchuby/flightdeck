// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { GroupsPanelContent } from '../GroupsPanel';
import type { ChatGroup, GroupMessage } from '../../../types';

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: { getState: () => ({ projects: {}, addGroupMessage: vi.fn() }) },
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ agents: [], setSelectedAgent: vi.fn() }),
    { getState: () => ({ agents: [], setSelectedAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('./CommsPanel', () => ({
  roleColor: () => 'text-blue-400',
}));

const testGroups: ChatGroup[] = [
  { name: 'backend-team', leadId: 'lead-1', memberIds: ['a1', 'a2', 'a3'], createdAt: '2026-03-14T10:00:00Z' },
  { name: 'frontend-team', leadId: 'lead-1', memberIds: ['a4', 'a5'], createdAt: '2026-03-14T10:01:00Z' },
];

const testMessages: Record<string, GroupMessage[]> = {
  'backend-team': [
    { id: 'msg-1', content: 'Hello team', fromRole: 'developer', fromAgentId: 'a1', timestamp: '2026-03-14T10:02:00Z' },
    { id: 'msg-2', content: 'Working on it', fromRole: 'architect', fromAgentId: 'a2', timestamp: '2026-03-14T10:03:00Z' },
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('GroupsPanelContent', () => {
  it('shows "No groups yet" when empty', () => {
    render(<GroupsPanelContent groups={[]} groupMessages={{}} leadId={null} />);
    expect(screen.getByText('No groups yet')).toBeDefined();
  });

  it('renders group names and member count', () => {
    render(<GroupsPanelContent groups={testGroups} groupMessages={{}} leadId="lead-1" />);
    expect(screen.getByText('backend-team')).toBeDefined();
    expect(screen.getByText('3 members')).toBeDefined();
    expect(screen.getByText('frontend-team')).toBeDefined();
    expect(screen.getByText('2 members')).toBeDefined();
  });

  it('clicking group expands it', () => {
    render(<GroupsPanelContent groups={testGroups} groupMessages={testMessages} leadId="lead-1" />);
    fireEvent.click(screen.getByText('backend-team'));
    expect(screen.getByText('Hello team')).toBeDefined();
    expect(screen.getByText('Working on it')).toBeDefined();
  });

  it('shows "No messages" when expanded group has no messages', () => {
    render(<GroupsPanelContent groups={testGroups} groupMessages={{}} leadId="lead-1" />);
    fireEvent.click(screen.getByText('frontend-team'));
    expect(screen.getByText('No messages')).toBeDefined();
  });

  it('collapses group on second click', () => {
    render(<GroupsPanelContent groups={testGroups} groupMessages={testMessages} leadId="lead-1" />);
    fireEvent.click(screen.getByText('backend-team'));
    expect(screen.getByText('Hello team')).toBeDefined();
    fireEvent.click(screen.getByText('backend-team'));
    expect(screen.queryByText('Hello team')).toBeNull();
  });
});
