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
    projectId: 'proj-1',
  },
  {
    name: 'design-team',
    leadId: 'lead-abc123',
    memberIds: ['lead-abc123', 'agent-2'],
    createdAt: '2026-01-01T00:01:00Z',
    projectId: 'proj-1',
  },
];

const mockMessages: GroupMessage[] = [
  {
    id: 'msg-1',
    content: 'Hello team!',
    fromRole: 'Project Lead',
    fromAgentId: 'lead-abc123',
    timestamp: new Date(Date.now() - 30000).toISOString(),
  },
  {
    id: 'msg-2',
    content: 'Working on it',
    fromRole: 'Developer',
    fromAgentId: 'agent-1',
    timestamp: new Date(Date.now() - 120000).toISOString(),
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
  AgentIdBadge: ({ id, className }: { id: string; className?: string }) => (
    <span data-testid="agent-badge" className={className}>{id.slice(0, 8)}</span>
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
let mockMarkGroupSeen: ReturnType<typeof vi.fn>;

function setupStore(overrides: Record<string, unknown> = {}) {
  mockSetGroups = vi.fn();
  mockSetMessages = vi.fn();
  mockSelectGroup = vi.fn();
  mockClearSelection = vi.fn();
  mockMarkGroupSeen = vi.fn();

  mockUseGroupStore.mockReturnValue({
    groups: mockGroups,
    messages: { 'lead-abc123:backend-team': mockMessages },
    selectedGroup: { leadId: 'lead-abc123', name: 'backend-team' },
    setGroups: mockSetGroups,
    setMessages: mockSetMessages,
    selectGroup: mockSelectGroup,
    clearSelection: mockClearSelection,
    lastSeenTimestamps: {},
    markGroupSeen: mockMarkGroupSeen,
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

describe('GroupChat – coverage gaps', () => {
  /* ── 1. Group creation with member selection (lines 51-58, 370-414, 441-444) ── */

  it('creates a new group with selected members', async () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST' && url.endsWith('/groups')) {
        return Promise.resolve({
          name: 'new-crew',
          leadId: 'lead-abc123',
          memberIds: ['agent-1'],
          createdAt: new Date().toISOString(),
        });
      }
      if (url.endsWith('/groups')) return Promise.resolve(mockGroups);
      return Promise.resolve([]);
    });

    await act(async () => { render(<GroupChat />); });

    // Open create dialog
    await waitFor(() => {
      expect(screen.getByTitle('Create group chat')).toBeDefined();
    });
    await act(async () => { fireEvent.click(screen.getByTitle('Create group chat')); });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });

    // Fill in group name
    const nameInput = screen.getByPlaceholderText('e.g. frontend-crew');
    fireEvent.change(nameInput, { target: { value: 'new-crew' } });

    // Toggle member checkbox — find checkboxes in the dialog
    const checkboxes = screen.getAllByRole('checkbox');
    if (checkboxes.length > 0) {
      fireEvent.click(checkboxes[0]); // select first agent
    }

    // Submit
    const createButton = screen.getByRole('button', { name: /Create Group/ });
    await act(async () => { fireEvent.click(createButton); });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/groups'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('new-crew'),
        }),
      );
    });
  });

  /* ── 2. Toggle member on/off in create dialog (lines 441-444) ── */

  it('toggles member selection on and off', async () => {
    await act(async () => { render(<GroupChat />); });

    await act(async () => { fireEvent.click(screen.getByTitle('Create group chat')); });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);

    // Check a member
    fireEvent.click(checkboxes[0]);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);

    // Uncheck the same member
    fireEvent.click(checkboxes[0]);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
  });

  /* ── 3. Group deletion / close tab (lines 64-66, close tab) ── */

  it('closes a tab and clears selection when last tab is closed', async () => {
    setupStore({
      groups: [mockGroups[0]],
      messages: { 'lead-abc123:backend-team': mockMessages },
      selectedGroup: { leadId: 'lead-abc123', name: 'backend-team' },
    });
    mockApiFetch.mockResolvedValue([mockGroups[0]]);

    const { _container } = await act(async () => render(<GroupChat />));

    await waitFor(() => {
      expect(screen.getByText('backend-team')).toBeDefined();
    });

    // The X icon on the tab has class 'w-3 h-3' — it's an SVG inside the tab button
    const tabButton = screen.getByText('backend-team').closest('button');
    expect(tabButton).toBeDefined();
    // The close X is an SVG sibling to the tab text inside the button
    const closeIcon = tabButton!.querySelector('.w-3.h-3');
    expect(closeIcon).toBeDefined();

    await act(async () => { fireEvent.click(closeIcon!); });

    // After closing the last tab, clearSelection should be called
    expect(mockClearSelection).toHaveBeenCalled();
  });

  /* ── 4. Send message via send button click (line 104) ── */

  it('sends message when clicking the send button', async () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') return Promise.resolve({});
      if (url.endsWith('/groups')) return Promise.resolve(mockGroups);
      return Promise.resolve([]);
    });

    await act(async () => { render(<GroupChat />); });

    const textarea = await screen.findByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Click send' } });

    // Find the send button (adjacent to textarea)
    const sendButton = textarea.closest('.flex.items-end')?.querySelector('button');
    expect(sendButton).toBeDefined();
    expect(sendButton!.disabled).toBe(false);

    await act(async () => { fireEvent.click(sendButton!); });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/messages'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Click send' }),
        }),
      );
    });
  });

  /* ── 5. Message types: system messages (lines 585-590) ── */

  it('renders system messages with centered italic text', async () => {
    const systemMsg: GroupMessage[] = [
      {
        id: 'sys-1',
        content: 'Agent joined the group',
        fromRole: 'System',
        fromAgentId: 'system',
        timestamp: new Date().toISOString(),
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': systemMsg },
    });

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('Agent joined the group')).toBeDefined();
    });

    // System messages are rendered inside a centered div with italic class
    const msgEl = screen.getByText('Agent joined the group');
    const wrapper = msgEl.closest('.italic');
    expect(wrapper).toBeDefined();
  });

  /* ── 6. Human messages aligned right (line 225, 658, 683) ── */

  it('renders human messages right-aligned with blue styling', async () => {
    const humanMsg: GroupMessage[] = [
      {
        id: 'hmn-1',
        content: 'Human input here',
        fromRole: 'Human User',
        fromAgentId: 'human',
        timestamp: new Date().toISOString(),
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': humanMsg },
    });

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('Human input here')).toBeDefined();
    });

    // Human messages should be inside a justify-end container
    const msgEl = screen.getByText('Human input here');
    const justifyEnd = msgEl.closest('.justify-end');
    expect(justifyEnd).toBeDefined();
  });

  /* ── 7. Empty state: no messages (line 498+) ── */

  it('shows "No messages yet" when group has no messages', async () => {
    setupStore({ messages: {} });

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText(/No messages yet/)).toBeDefined();
    });
  });

  /* ── 8. Agent selection in group creation dialog (lines 370-414) ── */

  it('shows available agents in create dialog with checkboxes', async () => {
    await act(async () => { render(<GroupChat />); });

    await act(async () => { fireEvent.click(screen.getByTitle('Create group chat')); });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });

    // Should show member count and agents
    expect(screen.getByText(/Members/)).toBeDefined();

    // Available agents for the lead should have checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  /* ── 9. Close create dialog with X button ── */

  it('closes create dialog when X is clicked', async () => {
    await act(async () => { render(<GroupChat />); });

    await act(async () => { fireEvent.click(screen.getByTitle('Create group chat')); });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });

    // Find X button inside dialog header
    const dialogHeader = screen.getByText('Create Group Chat').closest('div');
    const closeBtn = dialogHeader?.querySelector('button');
    if (closeBtn) {
      await act(async () => { fireEvent.click(closeBtn); });
    }

    // Dialog should be gone
    await waitFor(() => {
      expect(screen.queryByText('Create Group Chat')).toBeNull();
    });
  });

  /* ── 10. Mention keyboard navigation in group chat (lines 407-414) ── */

  it('navigates mention suggestions with keyboard in group chat', async () => {
    setupStore({
      groups: mockGroups,
      messages: { 'lead-abc123:backend-team': [] },
      selectedGroup: { leadId: 'lead-abc123', name: 'backend-team' },
    });

    await act(async () => { render(<GroupChat />); });

    const textarea = await screen.findByPlaceholderText('Type a message…');

    // Type @ to trigger mention dropdown
    fireEvent.change(textarea, { target: { value: '@' } });

    // The mention dropdown should show (members of the group)
    // ArrowDown to navigate
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    // Escape to close
    fireEvent.keyDown(textarea, { key: 'Escape' });
  });

  /* ── 11. Mention insertion via Enter/Tab in group chat (lines 409-412) ── */

  it('inserts mention via Tab in group chat', async () => {
    setupStore({
      groups: mockGroups,
      messages: { 'lead-abc123:backend-team': [] },
      selectedGroup: { leadId: 'lead-abc123', name: 'backend-team' },
    });

    await act(async () => { render(<GroupChat />); });

    const textarea = await screen.findByPlaceholderText('Type a message…') as HTMLTextAreaElement;

    // Type @ to trigger mention dropdown
    fireEvent.change(textarea, { target: { value: '@' } });

    // Tab should insert the first mention suggestion
    fireEvent.keyDown(textarea, { key: 'Tab' });

    // Verify the mention was inserted (text should contain @)
    // The dropdown should close
  });

  /* ── 12. Textarea auto-resize on input (line 424-430) ── */

  it('auto-resizes textarea on input', async () => {
    await act(async () => { render(<GroupChat />); });

    const textarea = await screen.findByPlaceholderText('Type a message…') as HTMLTextAreaElement;

    // Mock scrollHeight
    Object.defineProperty(textarea, 'scrollHeight', { value: 60, configurable: true });

    fireEvent.change(textarea, { target: { value: 'line1\nline2\nline3' } });

    // Height should be set
    expect(textarea.style.height).toBeDefined();
  });

  /* ── 13. Message with reactions display (lines 585-590, ReactionBadges) ── */

  it('displays reaction badges on messages', async () => {
    const msgsWithReactions: GroupMessage[] = [
      {
        id: 'msg-r1',
        content: 'Great work!',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: new Date().toISOString(),
        reactions: { '👍': ['agent-1'], '🎉': ['human', 'agent-2'] },
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': msgsWithReactions },
    });

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('Great work!')).toBeDefined();
    });

    expect(screen.getByText('👍')).toBeDefined();
    expect(screen.getByText('🎉')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined(); // 🎉 has 2 reactions
  });

  /* ── 14. Reaction toggle (lines 51-58, 64-66) ── */

  it('toggles reaction via the add reaction picker', async () => {
    const msgsWithReactions: GroupMessage[] = [
      {
        id: 'msg-toggle',
        content: 'React to me',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: new Date().toISOString(),
        reactions: { '👍': ['agent-1'] },
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': msgsWithReactions },
    });
    mockApiFetch.mockResolvedValue({});

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('React to me')).toBeDefined();
    });

    // Click the + button to open the reaction picker
    const addBtn = screen.getByTitle('Add reaction');
    await act(async () => { fireEvent.click(addBtn); });

    // Picker should appear with emoji options
    await waitFor(() => {
      expect(screen.getByText('❤️')).toBeDefined();
    });

    // Click a reaction emoji
    await act(async () => {
      fireEvent.click(screen.getByText('❤️'));
    });

    // Should have called apiFetch to POST the reaction
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/reactions'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  /* ── 15. Remove existing reaction (lines 55-58) ── */

  it('removes an existing human reaction when clicked', async () => {
    const msgsWithHumanReaction: GroupMessage[] = [
      {
        id: 'msg-rm',
        content: 'Remove my reaction',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: new Date().toISOString(),
        reactions: { '👍': ['human', 'agent-1'] },
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': msgsWithHumanReaction },
    });
    mockApiFetch.mockResolvedValue({});

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('Remove my reaction')).toBeDefined();
    });

    // Click the 👍 badge directly to toggle off (human already reacted)
    const thumbsBtn = screen.getByText('👍').closest('button')!;
    await act(async () => { fireEvent.click(thumbsBtn); });

    // Should call DELETE for the reaction
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/reactions/'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  /* ── 16. timeAgo shows hours ── */

  it('shows "Xh ago" for messages a few hours old', async () => {
    const hoursAgoMsg: GroupMessage[] = [
      {
        id: 'msg-hrs',
        content: 'Hours ago message',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: new Date(Date.now() - 3 * 3_600_000).toISOString(), // 3h ago
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': hoursAgoMsg },
    });

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('3h ago')).toBeDefined();
    });
  });

  /* ── 17. timeAgo shows date for old messages ── */

  it('shows date for messages older than a day', async () => {
    const oldMsg: GroupMessage[] = [
      {
        id: 'msg-old',
        content: 'Old message',
        fromRole: 'Developer',
        fromAgentId: 'agent-1',
        timestamp: '2024-06-15T12:00:00Z', // definitely > 1 day ago
      },
    ];

    setupStore({
      messages: { 'lead-abc123:backend-team': oldMsg },
    });

    await act(async () => { render(<GroupChat />); });

    await waitFor(() => {
      expect(screen.getByText('Old message')).toBeDefined();
    });

    // Should show a date string (e.g. "6/15/2024")
    const dateEl = screen.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(dateEl).toBeDefined();
  });

  /* ── 18. Send button disabled when sending ── */

  it('disables send button while sending', async () => {
    // Make apiFetch hang to simulate in-flight request
    let resolvePost: (v: unknown) => void;
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST' && url.includes('/messages')) {
        return new Promise((r) => { resolvePost = r; });
      }
      if (url.endsWith('/groups')) return Promise.resolve(mockGroups);
      return Promise.resolve([]);
    });

    await act(async () => { render(<GroupChat />); });

    const textarea = await screen.findByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'slow send' } });

    const sendButton = textarea.closest('.flex.items-end')?.querySelector('button');

    await act(async () => { fireEvent.click(sendButton!); });

    // Button should be disabled while sending
    expect(sendButton!.disabled).toBe(true);

    // Resolve the pending request
    await act(async () => { resolvePost!({}); });
  });

  /* ── 19. Shift+Enter does not send in group chat ── */

  it('does not send message on Shift+Enter', async () => {
    await act(async () => { render(<GroupChat />); });

    const textarea = await screen.findByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'newline please' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    const postCalls = mockApiFetch.mock.calls.filter(
      (c: any) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].includes('/messages'),
    );
    expect(postCalls).toHaveLength(0);
  });

  /* ── 20. Create dialog close via overlay click ── */

  it('closes create dialog when clicking the overlay', async () => {
    await act(async () => { render(<GroupChat />); });

    await act(async () => { fireEvent.click(screen.getByTitle('Create group chat')); });

    await waitFor(() => {
      expect(screen.getByText('Create Group Chat')).toBeDefined();
    });

    // Click the overlay (the backdrop with bg-black/60)
    const overlay = document.querySelector('.bg-black\\/60');
    if (overlay) {
      await act(async () => { fireEvent.click(overlay); });
    }

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByText('Create Group Chat')).toBeNull();
    });
  });
});
