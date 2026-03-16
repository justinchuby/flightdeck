import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../Shared', () => ({
  SkeletonCard: ({ lines }: { lines?: number }) => (
    <div data-testid="skeleton-card">skeleton-{lines ?? 3}</div>
  ),
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({
    tabs,
    activeTab,
    onTabChange,
  }: {
    tabs: Array<{ id: string; label: string; count?: number }>;
    activeTab: string;
    onTabChange: (id: string) => void;
  }) => (
    <div data-testid="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          data-testid={`tab-${t.id}`}
          data-active={t.id === activeTab}
          onClick={() => onTabChange(t.id)}
        >
          {t.label}{t.count != null ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  ),
}));

import { DataBrowser } from '../DataBrowser';

const defaultStats = {
  memory: 5,
  conversations: 3,
  messages: 42,
  decisions: 7,
  activity: 12,
  dagTasks: 4,
};

describe('DataBrowser – extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(defaultStats);
  });

  // ── Memory delete ────────────────────────────────────────────

  it('deletes a memory entry and removes it from the list', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats)
      .mockResolvedValueOnce([
        { id: 1, key: 'keep', value: 'v1', agentId: 'a-1111', leadId: 'l-2222', createdAt: '2024-01-01' },
        { id: 2, key: 'remove', value: 'v2', agentId: 'a-3333', leadId: 'l-4444', createdAt: '2024-01-02' },
      ])
      .mockResolvedValueOnce(undefined); // DELETE response

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-memory'));
    expect(await screen.findByText('remove')).toBeInTheDocument();

    // Click delete button for the second entry
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(screen.queryByText('remove')).not.toBeInTheDocument();
    });
    expect(screen.getByText('keep')).toBeInTheDocument();

    // Verify DELETE API was called
    expect(mockApiFetch).toHaveBeenCalledWith('/db/memory/2', { method: 'DELETE' });
  });

  it('shows entry count for memory panel', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats)
      .mockResolvedValueOnce([
        { id: 1, key: 'k1', value: 'v1', agentId: 'a-1', leadId: 'l-1', createdAt: '2024-01-01' },
        { id: 2, key: 'k2', value: 'v2', agentId: 'a-2', leadId: 'l-2', createdAt: '2024-01-02' },
      ]);

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-memory'));
    expect(await screen.findByText('2 entries')).toBeInTheDocument();
  });

  // ── Conversations expand/collapse ────────────────────────────

  it('expands and collapses a conversation to show messages', async () => {
    const convAgentId = 'agent-aabbcc';
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') return Promise.resolve(undefined);
      if (typeof url === 'string' && url.includes('/messages')) {
        return Promise.resolve([
          { id: 'msg-1', sender: 'user', content: 'Hello there', timestamp: '2024-01-01T12:30:45Z' },
          { id: 'msg-2', sender: 'agent', content: 'Hi! How can I help?', timestamp: '2024-01-01T12:31:00Z' },
        ]);
      }
      if (typeof url === 'string' && url.endsWith('/conversations')) {
        return Promise.resolve([
          { id: 'conv-1', agentId: convAgentId, taskId: 'build feature', createdAt: '2024-01-01' },
        ]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-conversations'));
    expect(await screen.findByText('1 conversations')).toBeInTheDocument();

    // Expand the conversation — agentId.slice(0,12) = 'agent-aabbcc'
    const agentIdSpan = screen.getByText(convAgentId.slice(0, 12));
    fireEvent.click(agentIdSpan.closest('.cursor-pointer')!);

    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText(/Hi! How can I help/)).toBeInTheDocument();

    // Verify sender labels rendered
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();

    // Collapse the conversation
    fireEvent.click(agentIdSpan.closest('.cursor-pointer')!);

    await waitFor(() => {
      expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
    });
  });

  it('shows "No messages" when expanded conversation has no messages', async () => {
    const convAgentId = 'agent-ccddee';
    mockApiFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/messages')) return Promise.resolve([]);
      if (typeof url === 'string' && url.endsWith('/conversations')) {
        return Promise.resolve([{ id: 'conv-1', agentId: convAgentId, createdAt: '2024-01-01' }]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-conversations'));
    await screen.findByText('1 conversations');

    const agentIdSpan = screen.getByText(convAgentId.slice(0, 12));
    fireEvent.click(agentIdSpan.closest('.cursor-pointer')!);
    expect(await screen.findByText('No messages')).toBeInTheDocument();
  });

  it('deletes a conversation and removes it from the list', async () => {
    const convAgentIdA = 'agent-aaaa11';
    const convAgentIdB = 'agent-bbbb22';
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') return Promise.resolve(undefined);
      if (typeof url === 'string' && url.endsWith('/conversations')) {
        return Promise.resolve([
          { id: 'conv-1', agentId: convAgentIdA, createdAt: '2024-01-01' },
          { id: 'conv-2', agentId: convAgentIdB, createdAt: '2024-01-02' },
        ]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-conversations'));
    expect(await screen.findByText(convAgentIdB.slice(0, 12))).toBeInTheDocument();

    const deleteButtons = screen.getAllByTitle('Delete conversation');
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(screen.queryByText(convAgentIdB.slice(0, 12))).not.toBeInTheDocument();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/db/conversations/conv-2', { method: 'DELETE' });
  });

  it('shows empty state for conversations tab', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/conversations')) return Promise.resolve([]);
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-conversations'));
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
  });

  // ── Decisions panel ──────────────────────────────────────────

  it('shows "needs confirmation" badge on decisions', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/decisions')) {
        return Promise.resolve([{
          id: 'd1', title: 'Pending Decision', status: 'pending',
          needsConfirmation: 1, rationale: 'This needs review',
          agentId: 'agent-abc12345', agentRole: 'architect', createdAt: '2024-01-01',
        }]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-decisions'));
    expect(await screen.findByText('Pending Decision')).toBeInTheDocument();
    expect(screen.getByText('needs confirmation')).toBeInTheDocument();
    expect(screen.getByText('This needs review')).toBeInTheDocument();
  });

  it('deletes a decision entry', async () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') return Promise.resolve(undefined);
      if (typeof url === 'string' && url.endsWith('/decisions')) {
        return Promise.resolve([
          { id: 'd1', title: 'Delete Me', status: 'confirmed', agentId: 'a-1', agentRole: 'dev', createdAt: '2024-01-01' },
        ]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-decisions'));
    expect(await screen.findByText('Delete Me')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => {
      expect(screen.queryByText('Delete Me')).not.toBeInTheDocument();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/db/decisions/d1', { method: 'DELETE' });
  });

  it('shows lead ID in decisions when present', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/decisions')) {
        return Promise.resolve([{
          id: 'd1', title: 'With Lead', status: 'confirmed',
          agentId: 'agent-1111', agentRole: 'architect', leadId: 'lead-9999', createdAt: '2024-01-01',
        }]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-decisions'));
    expect(await screen.findByText('With Lead')).toBeInTheDocument();
    expect(screen.getByText(/Lead:/)).toBeInTheDocument();
  });

  // ── Activity panel ───────────────────────────────────────────

  it('deletes an activity entry', async () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') return Promise.resolve(undefined);
      if (typeof url === 'string' && url.includes('/activity')) {
        return Promise.resolve([
          { id: 1, agentRole: 'worker', actionType: 'commit', summary: 'Remove me', timestamp: '2024-01-01T10:00:00Z' },
          { id: 2, agentRole: 'dev', actionType: 'test', summary: 'Keep me', timestamp: '2024-01-01T11:00:00Z' },
        ]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-activity'));
    expect(await screen.findByText('Remove me')).toBeInTheDocument();

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('Remove me')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledWith('/db/activity/1', { method: 'DELETE' });
  });

  it('shows event count with limit text', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/activity')) {
        return Promise.resolve([
          { id: 1, agentRole: 'worker', actionType: 'commit', summary: 'Did stuff', timestamp: '2024-01-01T10:00:00Z' },
        ]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-activity'));
    expect(await screen.findByText('1 events (most recent 200)')).toBeInTheDocument();
  });

  it('shows activity timestamp', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/activity')) {
        return Promise.resolve([
          { id: 1, agentRole: 'dev', actionType: 'test', summary: 'Ran tests', timestamp: '2024-01-01T14:30:45Z' },
        ]);
      }
      return Promise.resolve(defaultStats);
    });

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tab-activity'));
    expect(await screen.findByText('Ran tests')).toBeInTheDocument();
  });

  // ── Tab count badges ─────────────────────────────────────────

  it('shows stat counts in tab labels', async () => {
    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    // Tabs show counts from stats
    expect(screen.getByText('Memory (5)')).toBeInTheDocument();
    expect(screen.getByText('Conversations (3)')).toBeInTheDocument();
    expect(screen.getByText('Decisions (7)')).toBeInTheDocument();
    expect(screen.getByText('Activity Log (12)')).toBeInTheDocument();
  });

  // ── Stats panel large numbers ────────────────────────────────

  it('formats large numbers with locale string', async () => {
    mockApiFetch.mockImplementation(() => Promise.resolve({
      memory: 1234,
      conversations: 5678,
      messages: 999999,
      decisions: 42,
      activity: 100,
      dagTasks: 10,
    }));

    render(<DataBrowser />);
    // toLocaleString formatting for 1234
    expect(await screen.findByText('1,234')).toBeInTheDocument();
  });
});
