// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────

let mockAgents: any[] = [];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector({ agents: mockAgents }),
    { getState: () => ({ agents: mockAgents }) },
  ),
}));

// Import AFTER mocks
import { useUnreadMessages } from '../useUnreadMessages';

// ── Helpers ──────────────────────────────────────────────────

function makeAgent(id: string, messages: any[] = []) {
  return {
    id,
    role: { id: 'developer', name: 'Developer' },
    status: 'running',
    messages,
  };
}

function makeMsg(sender: string, timestamp: number) {
  return { type: 'text', text: 'msg', sender, timestamp };
}

// ── Tests ────────────────────────────────────────────────────

describe('useUnreadMessages', () => {
  beforeEach(() => {
    mockAgents = [];
  });

  it('returns false when agent has no messages', () => {
    mockAgents = [makeAgent('a1')];
    const { result } = renderHook(() => useUnreadMessages());
    expect(result.current.hasUnread('a1')).toBe(false);
  });

  it('returns true when agent has new messages and never viewed', () => {
    mockAgents = [makeAgent('a1', [makeMsg('agent', Date.now())])];
    const { result } = renderHook(() => useUnreadMessages());
    expect(result.current.hasUnread('a1')).toBe(true);
  });

  it('returns false after markRead is called', () => {
    mockAgents = [makeAgent('a1', [makeMsg('agent', Date.now() - 1000)])];
    const { result } = renderHook(() => useUnreadMessages());
    expect(result.current.hasUnread('a1')).toBe(true);

    act(() => {
      result.current.markRead('a1');
    });

    expect(result.current.hasUnread('a1')).toBe(false);
  });

  it('returns true when new messages arrive after markRead', () => {
    const now = Date.now();
    mockAgents = [makeAgent('a1', [makeMsg('agent', now - 2000)])];
    const { result } = renderHook(() => useUnreadMessages());

    act(() => {
      result.current.markRead('a1');
    });
    expect(result.current.hasUnread('a1')).toBe(false);

    // Simulate new message arriving
    mockAgents = [makeAgent('a1', [
      makeMsg('agent', now - 2000),
      makeMsg('agent', now + 1000),
    ])];
    expect(result.current.hasUnread('a1')).toBe(true);
  });

  it('ignores user messages for unread detection', () => {
    mockAgents = [makeAgent('a1', [makeMsg('user', Date.now())])];
    const { result } = renderHook(() => useUnreadMessages());
    expect(result.current.hasUnread('a1')).toBe(false);
  });

  it('tracks unread state independently per agent', () => {
    const now = Date.now();
    mockAgents = [
      makeAgent('a1', [makeMsg('agent', now)]),
      makeAgent('a2', [makeMsg('agent', now)]),
    ];
    const { result } = renderHook(() => useUnreadMessages());

    expect(result.current.hasUnread('a1')).toBe(true);
    expect(result.current.hasUnread('a2')).toBe(true);

    act(() => {
      result.current.markRead('a1');
    });

    expect(result.current.hasUnread('a1')).toBe(false);
    expect(result.current.hasUnread('a2')).toBe(true);
  });

  it('returns false for unknown agent', () => {
    const { result } = renderHook(() => useUnreadMessages());
    expect(result.current.hasUnread('nonexistent')).toBe(false);
  });
});
