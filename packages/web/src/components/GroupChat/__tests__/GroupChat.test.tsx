// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

/* ------------------------------------------------------------------ */
/*  Type stubs (mirrors @flightdeck/shared domain types)              */
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
/*  Test data                                                         */
/* ------------------------------------------------------------------ */
const mockAgents = [
  {
    id: 'lead-abc123',
    role: { id: 'lead', name: 'Project Lead', icon: '👑' },
    status: 'running',
    parentId: undefined,
    projectId: 'proj-1',
    projectName: 'My Project',
    childIds: ['agent-1'],
  },
  {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', icon: '💻' },
    status: 'running',
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
    memberIds: ['lead-abc123'],
    createdAt: '2026-01-01T00:01:00Z',
  },
];

const mockMessages: GroupMessage[] = [
  {
    id: 'msg-1',
    content: 'Hello team!',
    fromRole: 'Project Lead',
    fromAgentId: 'lead-abc123',
    timestamp: '2026-01-01T00:02:00Z',
  },
  {
    id: 'msg-2',
    content: 'Working on it',
    fromRole: 'Developer',
    fromAgentId: 'agent-1',
    timestamp: '2026-01-01T00:03:00Z',
  },
];

/* ------------------------------------------------------------------ */
/*  Mocks — MUST come before the component import                     */
/* ------------------------------------------------------------------ */

// --- apiFetch: return groups for /groups endpoint, empty otherwise --
const mockApiFetch = vi.fn().mockImplementation((url: string) => {
  if (typeof url === 'string' && url.endsWith('/groups')) {
    return Promise.resolve(mockGroups);
  }
  return Promise.resolve([]);
});

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// --- stores ---
vi.mock('../../../stores/groupStore', () => ({
  useGroupStore: Object.assign(vi.fn(), {
    getState: () => ({
      addGroup: vi.fn(),
      addMessage: vi.fn(),
      setGroups: vi.fn(),
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

// --- context ---
vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => null,
}));

// --- utilities ---
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

// --- child components ---
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
/*  Import component & store reference AFTER mocks are declared       */
/* ------------------------------------------------------------------ */
import { GroupChat } from '../GroupChat';
import { useGroupStore } from '../../../stores/groupStore';

const mockUseGroupStore = useGroupStore as unknown as ReturnType<typeof vi.fn>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
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

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
  setupStore();
});

afterEach(cleanup);

describe('GroupChat', () => {
  /* 1 ─ Tab bar renders group names -------------------------------- */
  it('renders tab bar with group names', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    // Tabs are populated by useEffect (fetchAllGroups → setOpenTabs)
    await waitFor(() => {
      expect(screen.getByText('backend-team')).toBeDefined();
    });
    expect(screen.getByText('design-team')).toBeDefined();
  });

  /* 2 ─ Empty state when no groups --------------------------------- */
  it('shows empty state when no groups exist', async () => {
    setupStore({ groups: [], selectedGroup: null });
    mockApiFetch.mockResolvedValue([]);

    await act(async () => {
      render(<GroupChat />);
    });

    expect(screen.getByText(/No group chats/)).toBeDefined();
  });

  /* 3 ─ Select-prompt when nothing is selected --------------------- */
  it('shows select prompt when no group is selected', async () => {
    setupStore({ selectedGroup: null });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(
        screen.getByText('Select a group chat tab to view messages'),
      ).toBeDefined();
    });
  });

  /* 4 ─ Displays messages for selected group ----------------------- */
  it('displays messages for the selected group', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('Hello team!')).toBeDefined();
    });
    expect(screen.getByText('Working on it')).toBeDefined();
  });

  /* 5 ─ Empty messages state --------------------------------------- */
  it('shows empty messages state when group has no messages', async () => {
    setupStore({ messages: {} });

    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText(/No messages yet/)).toBeDefined();
    });
  });

  /* 6 ─ Send button disabled when input is empty ------------------- */
  it('has send button disabled when input is empty', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type a message…')).toBeDefined();
    });

    // The send button is adjacent to the textarea
    const textarea = screen.getByPlaceholderText('Type a message…');
    const sendButton = textarea
      .closest('.flex.items-end')
      ?.querySelector('button');

    expect(sendButton).toBeDefined();
    expect(sendButton!.disabled).toBe(true);
  });

  /* 7 ─ Clicking a tab calls selectGroup --------------------------- */
  it('calls selectGroup when a tab is clicked', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    await waitFor(() => {
      expect(screen.getByText('backend-team')).toBeDefined();
    });

    // The tab text is inside a <span> inside a <button>; click the button
    const tabSpan = screen.getByText('design-team');
    const tabButton = tabSpan.closest('button')!;
    fireEvent.click(tabButton);

    // switchTab calls selectGroup(leadId, name)
    expect(mockSelectGroup).toHaveBeenCalledWith('lead-abc123', 'design-team');
  });

  /* 8 ─ Create group dialog opens ---------------------------------- */
  it('opens create group dialog when Plus button is clicked', async () => {
    await act(async () => {
      render(<GroupChat />);
    });

    // The Plus button has title="Create group chat"
    await waitFor(() => {
      expect(screen.getByTitle('Create group chat')).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Create group chat'));
    });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });
  });
});
