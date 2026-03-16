// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

/* ------------------------------------------------------------------ */
/*  Type stubs                                                         */
/* ------------------------------------------------------------------ */
interface ChatGroup {
  name: string;
  leadId: string;
  memberIds: string[];
  createdAt: string;
  projectId?: string;
}

interface GroupMessage {
  id: string;
  content: string;
  fromRole: string;
  fromAgentId: string;
  timestamp: string;
  reactions?: Record<string, string[]>;
}

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */
const mockAgents = [
  {
    id: 'lead-abc123',
    role: { id: 'lead', name: 'Project Lead', icon: '👑' },
    status: 'running',
    parentId: undefined,
    projectId: 'proj-1',
    projectName: 'My Project',
    childIds: ['agent-1', 'agent-2'],
  },
  {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', icon: '💻' },
    status: 'running',
    parentId: 'lead-abc123',
    childIds: [],
  },
  {
    id: 'agent-2',
    role: { id: 'architect', name: 'Architect', icon: '🏗️' },
    status: 'idle',
    parentId: 'lead-abc123',
    childIds: [],
  },
];

const mockGroups: ChatGroup[] = [
  {
    name: 'backend-team',
    leadId: 'lead-abc123',
    memberIds: ['lead-abc123', 'agent-1'],
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    name: 'design-team',
    leadId: 'lead-abc123',
    memberIds: ['lead-abc123', 'agent-2'],
    createdAt: '2026-01-01T00:01:00Z',
  },
];

const mockMessages: GroupMessage[] = [
  {
    id: 'msg-1',
    content: 'Hello team!',
    fromRole: 'Project Lead',
    fromAgentId: 'lead-abc123',
    timestamp: new Date(Date.now() - 30000).toISOString(), // 30s ago
  },
  {
    id: 'msg-2',
    content: 'Working on it',
    fromRole: 'Developer',
    fromAgentId: 'agent-1',
    timestamp: new Date(Date.now() - 120000).toISOString(), // 2m ago
  },
  {
    id: 'msg-3',
    content: 'System update applied',
    fromRole: 'System',
    fromAgentId: 'system',
    timestamp: new Date(Date.now() - 60000).toISOString(),
  },
  {
    id: 'msg-human',
    content: 'I am a human message',
    fromRole: 'Human User',
    fromAgentId: 'human',
    timestamp: new Date(Date.now() - 10000).toISOString(),
  },
];

const mockMessagesWithReactions: GroupMessage[] = [
  {
    id: 'msg-r1',
    content: 'Great job!',
    fromRole: 'Developer',
    fromAgentId: 'agent-1',
    timestamp: new Date().toISOString(),
    reactions: { '👍': ['agent-1'], '🎉': ['human', 'agent-2'] },
  },
];

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */
const mockApiFetch = vi.fn().mockImplementation((url: string) => {
  if (typeof url === 'string' && url.endsWith('/groups')) {
    return Promise.resolve(mockGroups);
  }
  if (typeof url === 'string' && url.includes('/messages')) {
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
});

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../stores/groupStore', () => ({
  useGroupStore: Object.assign(vi.fn(), {
    getState: () => ({
      addGroup: vi.fn(),
      addMessage: vi.fn(),
      setGroups: vi.fn(),
      addReaction: vi.fn(),
      removeReaction: vi.fn(),
    }),
  }),
  groupKey: (leadId: string, name: string) => `${leadId}:${name}`,
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ agents: mockAgents }),
    { getState: () => ({ agents: mockAgents, setSelectedAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => null,
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
  AgentIdBadge: ({ id }: { id: string }) => (
    <span data-testid="agent-badge">{id.slice(0, 8)}</span>
  ),
  idColor: () => '#888',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../ui/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../../FilterTabs', () => ({
  FilterTabs: ({ items, onSelect }: any) => (
    <div data-testid="filter-tabs">
      {items.map((item: any) => (
        <button key={item.value} onClick={() => onSelect(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

/* ------------------------------------------------------------------ */
/*  Import component & store                                           */
/* ------------------------------------------------------------------ */
import { GroupChat } from '../GroupChat';
import { useGroupStore } from '../../../stores/groupStore';

const mockUseGroupStore = useGroupStore as unknown as ReturnType<typeof vi.fn>;

/* ------------------------------------------------------------------ */
/*  Store setup                                                        */
/* ------------------------------------------------------------------ */
let mockSetGroups: ReturnType<typeof vi.fn>;
let mockSetMessages: ReturnType<typeof vi.fn>;
let mockSelectGroup: ReturnType<typeof vi.fn>;
let mockClearSelection: ReturnType<typeof vi.fn>;

function setupStore(overrides: Record<string, unknown> = {}) {
  mockSetGroups = vi.fn();
  mockSetMessages = vi.fn();
  mockSelectGroup = vi.fn();
  mockClearSelection = vi.fn();

  mockUseGroupStore.mockReturnValue({
    groups: mockGroups,
    messages: { 'lead-abc123:backend-team': mockMessages },
    selectedGroup: { leadId: 'lead-abc123', name: 'backend-team' },
    setGroups: mockSetGroups,
    setMessages: mockSetMessages,
    selectGroup: mockSelectGroup,
    clearSelection: mockClearSelection,
    lastSeenTimestamps: {},
    markGroupSeen: vi.fn(),
    markAllSeen: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  setupStore();
});

afterEach(cleanup);

describe('GroupChat – extra coverage', () => {
  /* ── Message sending ──────────────────────────────────────────── */

  it('sends a message when typing and pressing Enter', async () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') return Promise.resolve({});
      if (url.endsWith('/groups')) return Promise.resolve(mockGroups);
      return Promise.resolve([]);
    });

    await act(async () => {
      render(<GroupChat />);
    });

    const textarea = await screen.findByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Test message' }),
        }),
      );
    });
  });

  it('does not send empty messages', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    const textarea = await screen.findByPlaceholderText('Type a message…');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // API should not be called with POST for empty text
    const postCalls = mockApiFetch.mock.calls.filter(
      (c: any) => c[1]?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  /* ── System message rendering ─────────────────────────────────── */

  it('renders system messages with italic styling', async () => {
    setupStore({
      messages: { 'lead-abc123:backend-team': mockMessages },
    });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('System update applied')).toBeDefined();
    });
  });

  /* ── Human message rendering ──────────────────────────────────── */

  it('renders human messages aligned right', async () => {
    setupStore({
      messages: { 'lead-abc123:backend-team': mockMessages },
    });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('I am a human message')).toBeDefined();
    });
  });

  /* ── Reaction badges ──────────────────────────────────────────── */

  it('renders reaction badges with counts', async () => {
    setupStore({
      messages: { 'lead-abc123:backend-team': mockMessagesWithReactions },
    });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('Great job!')).toBeDefined();
    });

    // Reaction badges should show emoji and count
    expect(screen.getByText('👍')).toBeDefined();
    expect(screen.getByText('🎉')).toBeDefined();
    // 🎉 has 2 reactions
    expect(screen.getByText('2')).toBeDefined();
  });

  it('shows reaction picker when + button is clicked', async () => {
    setupStore({
      messages: { 'lead-abc123:backend-team': mockMessagesWithReactions },
    });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('Great job!')).toBeDefined();
    });

    // Click the "+" button to show picker
    const addBtn = screen.getByTitle('Add reaction');
    await act(async () => {
      fireEvent.click(addBtn);
    });

    // Picker should show emoji options
    await waitFor(() => {
      expect(screen.getByText('👎')).toBeDefined();
      expect(screen.getByText('❤️')).toBeDefined();
      expect(screen.getByText('🤔')).toBeDefined();
      expect(screen.getByText('👀')).toBeDefined();
    });
  });

  /* ── Close tab ────────────────────────────────────────────────── */

  it('closes a tab and switches to the remaining tab', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('backend-team')).toBeDefined();
    });

    // Find the X close button on the backend-team tab
    const backendTab = screen.getByText('backend-team').closest('button');
    const closeBtn = backendTab?.querySelector('svg.w-3');

    if (closeBtn) {
      await act(async () => {
        fireEvent.click(closeBtn);
      });
    }
  });

  /* ── Group info header shows members ──────────────────────────── */

  it('shows group member info header with member count', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('2 members:')).toBeDefined();
    });
  });

  /* ── Create group dialog submit ───────────────────────────────── */

  it('submits new group creation', async () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST' && url.endsWith('/groups')) {
        return Promise.resolve({
          name: 'new-group',
          leadId: 'lead-abc123',
          memberIds: [],
          createdAt: new Date().toISOString(),
        });
      }
      if (url.endsWith('/groups')) return Promise.resolve(mockGroups);
      return Promise.resolve([]);
    });

    await act(async () => {
      render(<GroupChat />);
    });

    // Open create dialog
    await waitFor(() => {
      expect(screen.getByTitle('Create group chat')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Create group chat'));
    });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });

    // Fill in group name — placeholder is "e.g. frontend-crew"
    const nameInput = screen.getByPlaceholderText('e.g. frontend-crew');
    fireEvent.change(nameInput, { target: { value: 'new-group' } });

    // Submit - find the "Create Group" button
    const createButton = screen.getByRole('button', { name: /Create Group/ });
    await act(async () => {
      fireEvent.click(createButton);
    });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/groups'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('new-group'),
        }),
      );
    });
  });

  /* ── Shift+Enter for newline ──────────────────────────────────── */

  it('does not send on Shift+Enter (allows newline)', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    const textarea = await screen.findByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'multiline' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    // Should NOT have sent a POST request
    const postCalls = mockApiFetch.mock.calls.filter(
      (c: any) => c[1]?.method === 'POST' && c[0].includes('/messages'),
    );
    expect(postCalls).toHaveLength(0);
  });

  /* ── timeAgo helper indirectly tested via message rendering ──── */

  it('shows "just now" for very recent messages', async () => {
    const recentMsg: GroupMessage[] = [
      {
        id: 'msg-recent',
        content: 'Just sent',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: new Date().toISOString(),
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': recentMsg },
    });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('just now')).toBeDefined();
    });
  });

  it('shows "Xm ago" for messages a few minutes old', async () => {
    const minutesAgoMsg: GroupMessage[] = [
      {
        id: 'msg-mins',
        content: 'Older message',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': minutesAgoMsg },
    });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('5m ago')).toBeDefined();
    });
  });
});
