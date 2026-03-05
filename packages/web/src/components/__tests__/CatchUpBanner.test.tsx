import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CatchUpBanner } from '../CatchUp/CatchUpBanner';
import type { CatchUpResponse } from '../CatchUp/CatchUpBanner';

// ── Mocks ──────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockSetApprovalQueueOpen = vi.fn();
vi.mock('../../stores/appStore', () => ({
  useAppStore: (sel: any) => {
    const state = {
      agents: [{ id: 'lead-123', role: { id: 'lead', name: 'Lead' }, parentId: undefined }],
      setApprovalQueueOpen: mockSetApprovalQueueOpen,
    };
    return sel(state);
  },
}));

vi.mock('../../stores/leadStore', () => ({
  useLeadStore: (sel: any) => {
    const state = { selectedLeadId: 'lead-123' };
    return sel(state);
  },
}));

let capturedOnIdle: (() => void) | undefined;
let capturedOnReturn: (() => void) | undefined;

vi.mock('../../hooks/useIdleTimer', () => ({
  useIdleTimer: (opts: any) => {
    capturedOnIdle = opts.onIdle;
    capturedOnReturn = opts.onReturn;
    return { isIdle: { current: false } };
  },
}));

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeResponse(overrides: Partial<CatchUpResponse['summary']> = {}, duration = 263): CatchUpResponse {
  return {
    awayDuration: duration,
    summary: {
      tasksCompleted: 0,
      decisionsPending: 0,
      decisionsAutoApproved: 0,
      commits: 0,
      agentsSpawned: 0,
      agentsCrashed: 0,
      contextCompactions: 0,
      budgetWarning: false,
      messageCount: 0,
      ...overrides,
    },
    highlights: [],
  };
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <CatchUpBanner />
    </MemoryRouter>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('CatchUpBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockReset();
    mockNavigate.mockReset();
    mockSetApprovalQueueOpen.mockReset();
    capturedOnIdle = undefined;
    capturedOnReturn = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render initially', () => {
    renderBanner();
    expect(screen.queryByTestId('catchup-banner')).toBeNull();
  });

  it('shows banner after idle → return with meaningful events', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ tasksCompleted: 3, commits: 5, decisionsPending: 1 })),
    });

    renderBanner();

    // Simulate idle then return
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeTruthy();
    expect(screen.getByText(/While you were away/)).toBeTruthy();
    // With decisionsPending > 0, severity is 'attention' → full grid shown
    expect(screen.getByText('1 decision pending')).toBeTruthy();
    expect(screen.getByText('3 tasks completed')).toBeTruthy();
    expect(screen.getByText('5 commits')).toBeTruthy();
  });

  it('does not show banner when no meaningful events', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse()),
    });

    renderBanner();

    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.queryByTestId('catchup-banner')).toBeNull();
  });

  it('dismisses on X button click', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ tasksCompleted: 2 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('catchup-dismiss'));
    expect(screen.queryByTestId('catchup-banner')).toBeNull();
  });

  it('dismisses on Escape key', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ commits: 1 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('catchup-banner')).toBeNull();
  });

  it('shows attention severity when decisions pending', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ decisionsPending: 2, tasksCompleted: 1 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByTestId('catchup-action-approval')).toBeTruthy();
    expect(screen.getByText('Open Approval Queue ⚠')).toBeTruthy();
  });

  it('shows critical severity with budget warning', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ budgetWarning: true, agentsCrashed: 2 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByTestId('catchup-item-budget')).toBeTruthy();
    expect(screen.getByText('Budget warning')).toBeTruthy();
  });

  it('shows compact all-good state for only positive events', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ tasksCompleted: 5, commits: 8 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByText('Everything is on track.')).toBeTruthy();
    // No action buttons in compact mode
    expect(screen.queryByTestId('catchup-action-replay')).toBeNull();
  });

  it('auto-dismisses after 20 seconds', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ decisionsPending: 1 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByTestId('catchup-banner')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.queryByTestId('catchup-banner')).toBeNull();
  });

  it('navigates to timeline on replay button click', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ decisionsPending: 1 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    fireEvent.click(screen.getByTestId('catchup-action-replay'));
    expect(mockNavigate).toHaveBeenCalledWith('/timeline');
  });

  it('opens approval queue on pending decisions click', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ decisionsPending: 3 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    fireEvent.click(screen.getByTestId('catchup-action-approval'));
    expect(mockSetApprovalQueueOpen).toHaveBeenCalledWith(true);
  });

  it('formats duration correctly', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ tasksCompleted: 1 }, 263)),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    expect(screen.getByText(/4m 23s/)).toBeTruthy();
  });

  it('skips messages under threshold of 5', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeResponse({ tasksCompleted: 1, messageCount: 3 })),
    });

    renderBanner();
    await act(async () => {
      capturedOnIdle?.();
      await capturedOnReturn?.();
    });

    // 3 messages < 5 threshold → not shown
    expect(screen.queryByText(/3 messages/)).toBeNull();
  });
});
