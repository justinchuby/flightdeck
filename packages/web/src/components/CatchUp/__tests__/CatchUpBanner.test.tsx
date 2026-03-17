import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';
import { useLeadStore } from '../../../stores/leadStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { CatchUpResponse } from '../CatchUpBanner';

// Capture idle timer callbacks
let idleCallbacks: { onIdle?: () => void; onReturn?: () => void } = {};
vi.mock('../../../hooks/useIdleTimer', () => ({
  useIdleTimer: (opts: { onIdle?: () => void; onReturn?: () => void }) => {
    idleCallbacks = opts;
    return { isIdle: { current: false } };
  },
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

import { CatchUpBanner } from '../CatchUpBanner';

function makeCatchUpResponse(overrides: Partial<CatchUpResponse> = {}): CatchUpResponse {
  return {
    awayDuration: 300,
    summary: {
      tasksCompleted: 3,
      tasksFailed: 0,
      decisionsPending: 2,
      decisionsAutoApproved: 1,
      commits: 2,
      agentsSpawned: 1,
      agentsCrashed: 0,
      contextCompactions: 0,
      budgetWarning: false,
      messageCount: 10,
    },
    highlights: [],
    ...overrides,
  };
}

function resetStores() {
  useAppStore.setState({
    agents: [
      {
        id: 'lead-1',
        role: { id: 'lead', name: 'Project Lead', systemPrompt: '' },
        status: 'running',
        model: 'gpt-4',
        provider: 'copilot',
        backend: 'acp',
        inputTokens: 0,
        outputTokens: 0,
        contextWindowSize: 200000,
        contextWindowUsed: 0,
        contextBurnRate: 0,
        estimatedExhaustionMinutes: null,
        pendingMessages: 0,
        createdAt: new Date().toISOString(),
        childIds: [],
        toolCalls: [],
        messages: [],
        isSubLead: false,
        hierarchyLevel: 0,
      },
    ] as any[],
    pendingDecisions: [],
    approvalQueueOpen: false,
  });
  useLeadStore.setState({
    selectedLeadId: 'lead-1',
    projects: {},
    drafts: {},
  });
  useSettingsStore.setState({
    oversightLevel: 'balanced',
  });
}

describe('CatchUpBanner', () => {
  beforeEach(() => {
    resetStores();
    mockApiFetch.mockReset();
    mockNavigate.mockReset();
    idleCallbacks = {};
    vi.useFakeTimers();
    // Stub localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Render nothing by default ────────────────────────────────────

  it('renders nothing when there is no catch-up data', () => {
    const { container } = render(<CatchUpBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing before user returns from idle', () => {
    render(<CatchUpBanner />);
    expect(screen.queryByTestId('catchup-banner')).not.toBeInTheDocument();
  });

  // ── Shows banner on return with data ─────────────────────────────

  it('shows catch-up banner after idle return with sufficient changes', async () => {
    const data = makeCatchUpResponse();
    mockApiFetch.mockResolvedValue(data);

    render(<CatchUpBanner />);

    // Simulate idle → return cycle
    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeInTheDocument();
    expect(screen.getByText(/While you were away/)).toBeInTheDocument();
    expect(screen.getByText(/5m/)).toBeInTheDocument(); // 300s = 5m
  });

  it('shows summary categories with correct counts', async () => {
    const data = makeCatchUpResponse();
    mockApiFetch.mockResolvedValue(data);

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByText('2 decisions pending')).toBeInTheDocument();
    expect(screen.getByText('3 tasks completed')).toBeInTheDocument();
    expect(screen.getByText('2 commits')).toBeInTheDocument();
  });

  it('shows action buttons when decisions pending or tasks failed', async () => {
    const data = makeCatchUpResponse({
      summary: {
        ...makeCatchUpResponse().summary,
        decisionsPending: 3,
        tasksFailed: 1,
      },
    });
    mockApiFetch.mockResolvedValue(data);

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByTestId('catchup-action-approval')).toBeInTheDocument();
    expect(screen.getByTestId('catchup-action-failed')).toBeInTheDocument();
    expect(screen.getByTestId('catchup-action-replay')).toBeInTheDocument();
  });

  // ── Dismiss behavior ─────────────────────────────────────────────

  it('dismisses when X button is clicked', async () => {
    mockApiFetch.mockResolvedValue(makeCatchUpResponse());

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catchup-dismiss'));
    expect(screen.queryByTestId('catchup-banner')).not.toBeInTheDocument();
  });

  it('dismisses when Dismiss action button is clicked', async () => {
    mockApiFetch.mockResolvedValue(makeCatchUpResponse());

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    fireEvent.click(screen.getByTestId('catchup-action-dismiss'));
    expect(screen.queryByTestId('catchup-banner')).not.toBeInTheDocument();
  });

  it('dismisses on Escape key', async () => {
    mockApiFetch.mockResolvedValue(makeCatchUpResponse());

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('catchup-banner')).not.toBeInTheDocument();
  });

  it('auto-dismisses after 20 seconds', async () => {
    mockApiFetch.mockResolvedValue(makeCatchUpResponse());

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.queryByTestId('catchup-banner')).not.toBeInTheDocument();
  });

  // ── Navigation actions ───────────────────────────────────────────

  it('navigates to timeline on Review in Replay click', async () => {
    mockApiFetch.mockResolvedValue(makeCatchUpResponse());

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    fireEvent.click(screen.getByTestId('catchup-action-replay'));
    expect(mockNavigate).toHaveBeenCalledWith('/timeline');
  });

  it('opens approval queue when "Open Approval Queue" is clicked', async () => {
    mockApiFetch.mockResolvedValue(makeCatchUpResponse());

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    fireEvent.click(screen.getByTestId('catchup-action-approval'));
    expect(useAppStore.getState().approvalQueueOpen).toBe(true);
  });

  // ── Threshold & filtering ────────────────────────────────────────

  it('does not show banner when total changes are below threshold', async () => {
    const data = makeCatchUpResponse({
      summary: {
        tasksCompleted: 1,
        tasksFailed: 0,
        decisionsPending: 0,
        decisionsAutoApproved: 0,
        commits: 0,
        agentsSpawned: 0,
        agentsCrashed: 0,
        contextCompactions: 0,
        budgetWarning: false,
        messageCount: 0,
      },
    });
    mockApiFetch.mockResolvedValue(data);

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.queryByTestId('catchup-banner')).not.toBeInTheDocument();
  });

  it('shows budget warning when present', async () => {
    const data = makeCatchUpResponse({
      summary: {
        ...makeCatchUpResponse().summary,
        budgetWarning: true,
      },
    });
    mockApiFetch.mockResolvedValue(data);

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByTestId('catchup-item-budget')).toBeInTheDocument();
    expect(screen.getByText('Budget warning')).toBeInTheDocument();
  });

  // ── Severity / compact mode ──────────────────────────────────────

  it('shows compact "all good" message when no issues', async () => {
    const data = makeCatchUpResponse({
      summary: {
        tasksCompleted: 5,
        tasksFailed: 0,
        decisionsPending: 0,
        decisionsAutoApproved: 2,
        commits: 3,
        agentsSpawned: 1,
        agentsCrashed: 0,
        contextCompactions: 0,
        budgetWarning: false,
        messageCount: 0,
      },
    });
    mockApiFetch.mockResolvedValue(data);

    render(<CatchUpBanner />);

    await act(async () => {
      idleCallbacks.onIdle?.();
    });
    await act(async () => {
      await idleCallbacks.onReturn?.();
    });

    expect(screen.getByText('Everything is on track.')).toBeInTheDocument();
  });
});
