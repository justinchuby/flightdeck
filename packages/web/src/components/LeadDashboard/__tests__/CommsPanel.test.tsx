// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const storeState = { agents: [], setSelectedAgent: vi.fn() };
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: (s: any) => any) => sel(storeState),
    { getState: () => storeState },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

import { CommsPanelContent } from '../CommsPanel';

const makeComm = (id: string, from: string, to: string, content = 'Hello') => ({
  id,
  fromId: from,
  toId: to,
  fromRole: 'Developer',
  toRole: 'Lead',
  content,
  timestamp: Date.now(),
  type: 'agent_message' as const,
});

describe('CommsPanelContent', () => {
  it('renders without comms', () => {
    const { container } = render(<CommsPanelContent comms={[]} groupMessages={{}} />);
    expect(container).toBeTruthy();
  });

  it('renders comm messages', () => {
    render(
      <CommsPanelContent
        comms={[makeComm('c1', 'a1', 'lead', 'Test message')]}
        groupMessages={{}}
      />,
    );
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('renders multiple comms', () => {
    render(
      <CommsPanelContent
        comms={[
          makeComm('c1', 'a1', 'lead', 'First message'),
          makeComm('c2', 'a2', 'lead', 'Second message'),
        ]}
        groupMessages={{}}
      />,
    );
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });

  it('renders group messages', () => {
    const groupMessages = {
      'group-1': [
        { id: 'gm1', groupId: 'group-1', groupName: 'Backend Team', fromId: 'a1', fromRole: 'Developer', content: 'Group hello', timestamp: Date.now() },
      ],
    };
    render(<CommsPanelContent comms={[]} groupMessages={groupMessages as any} />);
    expect(screen.getByText('Group hello')).toBeInTheDocument();
  });

  it('shows from/to roles', () => {
    render(
      <CommsPanelContent
        comms={[makeComm('c1', 'a1', 'lead', 'role test')]}
        groupMessages={{}}
      />,
    );
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });
});
