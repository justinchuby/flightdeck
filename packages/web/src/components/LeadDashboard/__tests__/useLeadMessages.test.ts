// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Store mock ───────────────────────────────────────────────────

const mockAddProject = vi.fn();
const mockSelectLead = vi.fn();
const mockSetMessages = vi.fn();
let mockProjects: Record<string, { messages: any[] }> = {};
let mockSelectedLeadId: string | null = null;

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: (s: any) => any) => {
      const state = {
        projects: mockProjects,
        selectedLeadId: mockSelectedLeadId,
      };
      return typeof sel === 'function' ? sel(state) : state;
    },
    {
      getState: () => ({
        projects: mockProjects,
        selectedLeadId: mockSelectedLeadId,
        addProject: mockAddProject,
        selectLead: mockSelectLead,
        setMessages: mockSetMessages,
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
    mockProjects = {};
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
    mockProjects = {}; // empty store
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
    expect(mockSetMessages).toHaveBeenCalled();
  });

  it('uses project API path for historical leads', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/projects/')) {
        return Promise.resolve({ messages: [] });
      }
      return Promise.resolve([]);
    });

    renderHook(
      () => useLeadMessages('project:abc-123', false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/abc-123/messages'),
        expect.anything(),
      );
    });
  });

  it('does not reload messages when store already has them', async () => {
    mockProjects = {
      'lead-1': { messages: [{ type: 'text', text: 'existing', sender: 'agent', timestamp: 123 }] },
    };

    renderHook(
      () => useLeadMessages('lead-1', false, makeWs(), makeScrollRef()),
      { wrapper: createWrapper() },
    );

    // Give queries a chance to fire
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // The message history query should not have fired since store has messages
    const msgCalls = mockApiFetch.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('/agents/lead-1/messages'),
    );
    expect(msgCalls).toHaveLength(0);
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
      expect(mockSetMessages).toHaveBeenCalledWith('lead-1', expect.any(Array));
    });
  });
});
