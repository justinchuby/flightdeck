// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Store mock ───────────────────────────────────────────────────

const mockAddProject = vi.fn();
const mockSelectLead = vi.fn();
let mockSelectedLeadId: string | null = null;

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: (s: any) => any) => {
      const state = {
        selectedLeadId: mockSelectedLeadId,
      };
      return typeof sel === 'function' ? sel(state) : state;
    },
    {
      getState: () => ({
        selectedLeadId: mockSelectedLeadId,
        addProject: mockAddProject,
        selectLead: mockSelectLead,
      }),
    },
  ),
}));

// ── Message store mock ──────────────────────────────────────────

const mockMergeHistory = vi.fn();
const mockPrependHistory = vi.fn();
let mockChannels: Record<string, { messages: any[] }> = {};

vi.mock('../../../stores/messageStore', () => ({
  useMessageStore: Object.assign(
    (sel: (s: any) => any) => {
      const state = { channels: mockChannels };
      return typeof sel === 'function' ? sel(state) : state;
    },
    {
      getState: () => ({
        channels: mockChannels,
        mergeHistory: mockMergeHistory,
        prependHistory: mockPrependHistory,
      }),
    },
  ),
}));

// ── API mock ─────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useLeadMessages } from '../useLeadMessages';

// ── Helpers ──────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function makeWs() {
  return { subscribe: vi.fn(), unsubscribe: vi.fn() };
}

function makeScrollRef() {
  return { current: true };
}

// ── Tests ────────────────────────────────────────────────────────

describe('useLeadMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannels = {};
    mockSelectedLeadId = null;
    mockApiFetch.mockResolvedValue([]);
  });

  it('fetches leads on mount when not readOnly', async () => {
    const leads = [
      { id: 'lead-1', status: 'running' },
      { id: 'lead-2', status: 'idle' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/lead') return Promise.resolve(leads);
      return Promise.resolve({ messages: [] });
    });

    renderHook(
      () => useLeadMessages(null, false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead', expect.anything());
    });
    expect(mockAddProject).toHaveBeenCalledWith('lead-1');
    expect(mockAddProject).toHaveBeenCalledWith('lead-2');
  });

  it('auto-selects first running lead when none selected', async () => {
    const leads = [
      { id: 'lead-1', status: 'idle' },
      { id: 'lead-2', status: 'running' },
    ];
    mockSelectedLeadId = null;
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/lead') return Promise.resolve(leads);
      return Promise.resolve({ messages: [] });
    });

    renderHook(
      () => useLeadMessages(null, false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockSelectLead).toHaveBeenCalledWith('lead-2');
    });
  });

  it('skips initial fetch in readOnly mode', () => {
    renderHook(
      () => useLeadMessages(null, true, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    // The query should not have been enabled (readOnly=true)
    expect(mockApiFetch).not.toHaveBeenCalledWith('/lead', expect.anything());
  });

  it('subscribes to WS when a lead is selected and not readOnly', () => {
    const ws = makeWs();

    renderHook(
      () => useLeadMessages('lead-1', false, ws, makeScrollRef()),
      { wrapper: createWrapper() },
    );

    expect(ws.subscribe).toHaveBeenCalledWith('lead-1');
  });

  it('does not subscribe to WS in readOnly mode', () => {
    const ws = makeWs();

    renderHook(
      () => useLeadMessages('lead-1', true, ws, makeScrollRef()),
      { wrapper: createWrapper() },
    );

    expect(ws.subscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes from WS on cleanup', () => {
    const ws = makeWs();

    const { unmount } = renderHook(
      () => useLeadMessages('lead-1', false, ws, makeScrollRef()),
      { wrapper: createWrapper() },
    );

    unmount();
    expect(ws.unsubscribe).toHaveBeenCalledWith('lead-1');
  });

  it('resets chatInitialScroll when lead changes', () => {
    const scrollRef = makeScrollRef();
    expect(scrollRef.current).toBe(true);

    renderHook(
      () => useLeadMessages('lead-1', false, makeWs(), scrollRef),
      { wrapper: createWrapper() },
    );

    expect(scrollRef.current).toBe(false);
  });

  it('loads message history for selected lead when store is empty', async () => {
    mockChannels = {}; // empty store
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/agents/lead-1/messages')) {
        return Promise.resolve({
          messages: [
            { content: 'Hello', sender: 'agent', timestamp: '2024-01-01T00:00:00Z' },
          ],
        });
      }
      return Promise.resolve([]);
    });

    renderHook(
      () => useLeadMessages('lead-1', false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/agents/lead-1/messages'),
        expect.anything(),
      );
    });
    expect(mockMergeHistory).toHaveBeenCalled();
  });

  // project:xxx historical path removed by eliminate-project-key refactor

  it('merges history with existing WS messages rather than skipping', async () => {
    mockChannels = {
      'lead-1': { messages: [{ type: 'text', text: 'ws-msg', sender: 'agent', timestamp: 2000 }] },
    };
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/lead') return Promise.resolve([{ id: 'lead-1', status: 'running' }]);
      if (typeof path === 'string' && path.includes('/agents/lead-1/messages')) {
        return Promise.resolve({
          messages: [
            { content: 'old-history', sender: 'agent', timestamp: '2024-01-01T00:00:01.000Z' },
          ],
        });
      }
      return Promise.resolve({ messages: [] });
    });

    renderHook(
      () => useLeadMessages('lead-1', false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // History fetch SHOULD fire even when store has messages
    const msgCalls = mockApiFetch.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('/agents/lead-1/messages'),
    );
    expect(msgCalls.length).toBeGreaterThan(0);
  });

  it('handles non-array leads response gracefully', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/lead') return Promise.resolve('not-an-array');
      return Promise.resolve({ messages: [] });
    });

    renderHook(
      () => useLeadMessages(null, false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead', expect.anything());
    });
    // Should not crash
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it('pre-loads message history for discovered leads', async () => {
    const leads = [{ id: 'lead-1', status: 'running' }];
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/lead') return Promise.resolve(leads);
      if (path.includes('/agents/lead-1/messages')) {
        return Promise.resolve({
          messages: [{ content: 'pre-loaded', sender: 'agent', timestamp: '2024-01-01T00:00:00Z' }],
        });
      }
      return Promise.resolve({ messages: [] });
    });

    renderHook(
      () => useLeadMessages(null, false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockMergeHistory).toHaveBeenCalledWith('lead-1', expect.any(Array));
    });
  });

  it('returns hasMore=true after initial load with full page', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/lead')) return Promise.resolve([]);
      if (url.includes('/messages')) {
        const msgs = Array.from({ length: 200 }, (_, i) => ({
          id: i + 1,
          content: `Msg ${i}`,
          sender: 'agent',
          timestamp: new Date(1000 + i).toISOString(),
        }));
        return Promise.resolve({ messages: msgs, hasMore: true });
      }
      return Promise.resolve({ messages: [] });
    });

    const { result } = renderHook(
      () => useLeadMessages('lead-1', false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });
  });

  it('loadOlderMessages calls API with before cursor and prepends results', async () => {
    let callCount = 0;
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/lead')) return Promise.resolve([]);
      if (url.includes('/messages') && url.includes('before=')) {
        // Pagination request
        return Promise.resolve({
          messages: [
            { id: 1, content: 'Old msg', sender: 'agent', timestamp: new Date(500).toISOString() },
          ],
          hasMore: false,
        });
      }
      if (url.includes('/messages')) {
        callCount++;
        return Promise.resolve({
          messages: [
            { id: 10, content: 'Recent', sender: 'agent', timestamp: new Date(1000).toISOString() },
          ],
          hasMore: true,
        });
      }
      return Promise.resolve({ messages: [] });
    });

    const { result } = renderHook(
      () => useLeadMessages('lead-1', false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });

    // Trigger load older
    await act(async () => {
      await result.current.loadOlderMessages();
    });

    expect(mockPrependHistory).toHaveBeenCalledWith('lead-1', expect.any(Array));
    expect(result.current.hasMore).toBe(false);
  });

  it('resets pagination state when switching leads', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/lead')) return Promise.resolve([]);
      if (url.includes('/messages')) {
        return Promise.resolve({
          messages: [{ id: 5, content: 'Msg', sender: 'agent', timestamp: new Date(1000).toISOString() }],
          hasMore: false,
        });
      }
      return Promise.resolve({ messages: [] });
    });

    const { result, rerender } = renderHook(
      ({ leadId }: { leadId: string | null }) =>
        useLeadMessages(leadId, false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper(), initialProps: { leadId: 'lead-1' } },
    );

    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    // Switch lead — hasMore should reset to true
    rerender({ leadId: 'lead-2' });
    expect(result.current.hasMore).toBe(true);
  });
});
