// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────

const mockAppState = {
  agents: [] as any[],
  pendingDecisions: [] as any[],
  connected: true,
};
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: typeof mockAppState) => any) => selector(mockAppState),
}));

const mockLeadState = {
  projects: {} as Record<string, any>,
  selectedLeadId: null as string | null,
};
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (selector: (s: typeof mockLeadState) => any) => selector(mockLeadState),
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function makeAgent(id: string, status: string) {
  return { id, status, role: { id: 'dev', name: 'Developer', icon: '🔧' } };
}

function makeDagStatus(summary: Partial<Record<string, number>>, tasks: any[] = []) {
  return {
    tasks,
    fileLockMap: {},
    summary: {
      pending: 0, ready: 0, running: 0, done: 0,
      failed: 0, blocked: 0, paused: 0, skipped: 0,
      ...summary,
    },
  };
}

function makeTask(id: string, dagStatus: string, opts: Record<string, any> = {}) {
  return {
    id,
    leadId: 'lead-1',
    role: 'developer',
    description: `Task ${id}`,
    files: [],
    dependsOn: [],
    dagStatus,
    priority: 1,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...opts,
  };
}

/** A valid AttentionApiResponse for testing */
function makeApiResponse(overrides: Record<string, any> = {}) {
  return {
    scope: 'global',
    escalation: 'yellow',
    summary: {
      failedCount: 1,
      blockedCount: 0,
      staleCount: 1,
      decisionCount: 1,
      totalCount: 3,
    },
    items: [
      {
        type: 'failed',
        severity: 'critical',
        task: { id: 'task-1', title: 'Deploy auth service', projectId: 'proj-1' },
        reason: 'Build failed',
      },
      {
        type: 'stale',
        severity: 'warning',
        task: { id: 'task-2', title: 'Run integration tests', projectId: 'proj-1' },
        durationMs: 1_800_000, // 30 minutes
      },
      {
        type: 'decision',
        severity: 'warning',
        decision: { id: 'dec-1', title: 'Approve database migration', projectId: 'proj-1' },
      },
    ],
    ...overrides,
  };
}

let useAttentionItems: typeof import('../useAttentionItems').useAttentionItems;

beforeEach(async () => {
  mockApiFetch.mockReset().mockRejectedValue(new Error('API unavailable'));
  mockAppState.agents = [];
  mockAppState.pendingDecisions = [];
  mockAppState.connected = true;
  mockLeadState.projects = {};
  mockLeadState.selectedLeadId = null;

  vi.resetModules();
  const mod = await import('../useAttentionItems');
  useAttentionItems = mod.useAttentionItems;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('useAttentionItems', () => {
  describe('API-driven state', () => {
    it('returns server-computed escalation and counts from API response', async () => {
      const apiResponse = makeApiResponse({ escalation: 'red' });
      mockApiFetch.mockResolvedValue(apiResponse);
      mockAppState.agents = [makeAgent('a1', 'running'), makeAgent('a2', 'idle')];

      const { result } = renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(result.current.escalation).toBe('red');
      });

      expect(result.current.failedTaskCount).toBe(1);
      expect(result.current.pendingDecisionCount).toBe(1);
      expect(result.current.agentCount).toBe(2);
      expect(result.current.runningCount).toBe(1);
    });

    it('maps API items to AttentionItem format with correct kinds', async () => {
      mockApiFetch.mockResolvedValue(makeApiResponse());
      mockAppState.agents = [makeAgent('a1', 'running')];

      const { result } = renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(result.current.items.length).toBe(3);
      });

      const failed = result.current.items.find(i => i.kind === 'failed');
      expect(failed).toBeDefined();
      expect(failed!.label).toBe('Deploy auth service');
      expect(failed!.action).toEqual({ type: 'navigate', to: '/projects/proj-1/tasks' });

      const stale = result.current.items.find(i => i.kind === 'stale');
      expect(stale).toBeDefined();
      expect(stale!.label).toContain('Run integration tests');
      expect(stale!.label).toContain('30m'); // durationMs formatted

      const decision = result.current.items.find(i => i.kind === 'decision');
      expect(decision).toBeDefined();
      expect(decision!.label).toBe('Approve database migration');
      expect(decision!.action).toEqual({ type: 'callback', key: 'openApprovalQueue' });
    });

    it('passes projectId to API when a project is selected', async () => {
      mockApiFetch.mockResolvedValue(makeApiResponse({ scope: 'project' }));
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.selectedLeadId = 'proj-42';

      renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining('scope=project&projectId=proj-42')
        );
      });
    });

    it('computes progress from store DAG data alongside API escalation', async () => {
      mockApiFetch.mockResolvedValue(makeApiResponse());
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.projects = {
        'proj-1': { dagStatus: makeDagStatus({ done: 8, running: 2, pending: 5 }) },
      };

      const { result } = renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(result.current.escalation).toBe('yellow');
      });
      expect(result.current.progressText).toBe('8/15 done');
    });
  });

  describe('client-side fallback', () => {
    it('derives escalation from task data when API is unavailable', () => {
      mockApiFetch.mockRejectedValue(new Error('API unavailable'));
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.projects = {
        'proj-1': {
          dagStatus: makeDagStatus(
            { done: 3, running: 1, failed: 1 },
            [makeTask('t1', 'failed', { title: 'Broken task' })],
          ),
        },
      };

      const { result } = renderHook(() => useAttentionItems());

      // Failed task → red escalation
      expect(result.current.escalation).toBe('red');
      expect(result.current.failedTaskCount).toBe(1);
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].kind).toBe('failed');
      expect(result.current.items[0].label).toBe('Broken task');
    });

    it('returns green with empty items when all is healthy', () => {
      mockApiFetch.mockRejectedValue(new Error('API unavailable'));
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.projects = {
        'proj-1': { dagStatus: makeDagStatus({ done: 5, running: 2 }) },
      };

      const { result } = renderHook(() => useAttentionItems());

      expect(result.current.escalation).toBe('green');
      expect(result.current.items).toHaveLength(0);
      expect(result.current.progressText).toBe('5/7 done');
    });

    it('includes pending decisions from appStore', () => {
      mockApiFetch.mockRejectedValue(new Error('API unavailable'));
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockAppState.pendingDecisions = [
        { id: 'dec-1', title: 'Approve migration', status: 'recorded' },
        { id: 'dec-2', title: 'Allow file write', status: 'recorded' },
      ];

      const { result } = renderHook(() => useAttentionItems());

      expect(result.current.escalation).toBe('yellow');
      expect(result.current.pendingDecisionCount).toBe(2);
      const decisions = result.current.items.filter(i => i.kind === 'decision');
      expect(decisions).toHaveLength(2);
    });

    it('returns empty progressText when no projects exist (AC-13.10)', () => {
      mockApiFetch.mockRejectedValue(new Error('API unavailable'));
      mockAppState.agents = [makeAgent('a1', 'running')];
      // No projects at all
      const { result } = renderHook(() => useAttentionItems());

      expect(result.current.progressText).toBe('');
      expect(result.current.escalation).toBe('green');
    });

    it('detects blocked tasks only after 30min threshold', () => {
      mockApiFetch.mockRejectedValue(new Error('API unavailable'));
      mockAppState.agents = [makeAgent('a1', 'running')];

      const recentTime = new Date(Date.now() - 5 * 60_000).toISOString();   // 5 min ago
      const oldTime = new Date(Date.now() - 45 * 60_000).toISOString();     // 45 min ago

      mockLeadState.projects = {
        'proj-1': {
          dagStatus: makeDagStatus(
            { blocked: 2, running: 1 },
            [
              makeTask('t-recent', 'blocked', { createdAt: recentTime }),
              makeTask('t-old', 'blocked', { createdAt: oldTime }),
            ],
          ),
        },
      };

      const { result } = renderHook(() => useAttentionItems());

      // Only the old blocked task should appear (>30min threshold)
      const blocked = result.current.items.filter(i => i.kind === 'blocked');
      expect(blocked).toHaveLength(1);
      expect(blocked[0].id).toBe('blocked-t-old');
    });

    it('aggregates across multiple projects when no project selected', () => {
      mockApiFetch.mockRejectedValue(new Error('API unavailable'));
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.projects = {
        'proj-1': {
          dagStatus: makeDagStatus(
            { done: 3, failed: 1 },
            [makeTask('t1', 'failed', { title: 'P1 fail' })],
          ),
        },
        'proj-2': {
          dagStatus: makeDagStatus(
            { done: 5, running: 2, failed: 1 },
            [makeTask('t2', 'failed', { title: 'P2 fail' })],
          ),
        },
      };

      const { result } = renderHook(() => useAttentionItems());

      expect(result.current.escalation).toBe('red');
      expect(result.current.failedTaskCount).toBe(2);
      expect(result.current.progressText).toBe('8/12 done');
      expect(result.current.items).toHaveLength(2);
    });
  });

  describe('WebSocket push (hybrid WS+polling)', () => {
    it('refetches attention data when attention:changed event fires', async () => {
      const apiResponse = makeApiResponse();
      mockApiFetch.mockResolvedValue(apiResponse);
      mockAppState.agents = [makeAgent('a1', 'running')];

      const { result } = renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(result.current.escalation).toBe('yellow');
      });

      // Reset and prepare updated response
      mockApiFetch.mockClear();
      const updatedResponse = makeApiResponse({ escalation: 'red' });
      mockApiFetch.mockResolvedValue(updatedResponse);

      // Fire attention:changed event (simulating WS push)
      window.dispatchEvent(new CustomEvent('attention:changed'));

      await waitFor(() => {
        expect(result.current.escalation).toBe('red');
      });
      // Should have refetched after the event
      expect(mockApiFetch).toHaveBeenCalled();
    });

    it('debounces rapid attention:changed events into a single refetch', async () => {
      const apiResponse = makeApiResponse();
      mockApiFetch.mockResolvedValue(apiResponse);
      mockAppState.agents = [makeAgent('a1', 'running')];

      renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledTimes(1); // initial fetch
      });

      mockApiFetch.mockClear();

      // Fire 5 rapid events (simulating burst of dag:updated)
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new CustomEvent('attention:changed'));
      }

      // Wait for debounce (300ms) + a bit extra
      await new Promise(r => setTimeout(r, 500));

      // Should debounce to ~1 refetch, not 5
      expect(mockApiFetch.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('does not refetch on attention:changed when disconnected', async () => {
      mockAppState.connected = false;
      mockApiFetch.mockResolvedValue(makeApiResponse());
      mockAppState.agents = [makeAgent('a1', 'running')];

      renderHook(() => useAttentionItems());

      // No fetch when disconnected
      expect(mockApiFetch).not.toHaveBeenCalled();

      // Fire event — should not trigger fetch
      window.dispatchEvent(new CustomEvent('attention:changed'));
      await new Promise(r => setTimeout(r, 500));

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('cleans up event listener on unmount', async () => {
      mockApiFetch.mockResolvedValue(makeApiResponse());
      mockAppState.agents = [makeAgent('a1', 'running')];

      const { unmount } = renderHook(() => useAttentionItems());

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledTimes(1);
      });

      unmount();
      mockApiFetch.mockClear();

      // Fire event after unmount — should NOT trigger fetch
      window.dispatchEvent(new CustomEvent('attention:changed'));
      await new Promise(r => setTimeout(r, 500));

      expect(mockApiFetch).not.toHaveBeenCalled();
    });
  });
});
