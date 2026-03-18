// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCatchUpSummary } from '../useCatchUpSummary';

// Minimal Decision type matching the shape used in the hook
interface MockDecision {
  id: string;
  needsConfirmation: boolean;
  status: string;
  title: string;
  rationale: string;
  agentId: string;
  timestamp: string;
  category: string;
}

function makeDecision(overrides: Partial<MockDecision> = {}): MockDecision {
  return {
    id: 'd-1',
    needsConfirmation: false,
    status: 'recorded',
    title: 'Test',
    rationale: 'reason',
    agentId: 'a1',
    timestamp: new Date().toISOString(),
    category: 'architecture',
    ...overrides,
  };
}

function makeAgent(id: string, status = 'running', parentId?: string) {
  return { id, status, parentId };
}

describe('useCatchUpSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null catchUpSummary initially', () => {
    const { result } = renderHook(() =>
      useCatchUpSummary('lead-1', [], null),
    );
    expect(result.current.catchUpSummary).toBeNull();
  });

  it('returns null when currentProject is null', () => {
    const agents = [makeAgent('a1', 'completed', 'lead-1')];
    const { result } = renderHook(() =>
      useCatchUpSummary('lead-1', agents, null),
    );
    expect(result.current.catchUpSummary).toBeNull();
  });

  it('does not show catch-up when user is active (< 60s)', () => {
    const agents = [
      makeAgent('a1', 'completed', 'lead-1'),
      makeAgent('a2', 'completed', 'lead-1'),
      makeAgent('a3', 'completed', 'lead-1'),
    ];
    const project = {
      comms: Array.from({ length: 10 }, (_, i) => ({
        id: `c-${i}`, fromId: 'a1', fromRole: 'dev', toId: 'a2', toRole: 'dev',
        content: 'msg', timestamp: Date.now(),
      })),
    };

    const { result } = renderHook(() =>
      useCatchUpSummary('lead-1', agents, project),
    );
    expect(result.current.catchUpSummary).toBeNull();
  });

  it('shows catch-up after 60s of inactivity with sufficient changes', () => {
    // Start with empty data and active user
    const initialProject = { comms: [] as any[], decisions: [], agentReports: [] };
    const agents: ReturnType<typeof makeAgent>[] = [];

    const { result, rerender } = renderHook(
      ({ leadId, agents: a, project }) =>
        useCatchUpSummary(leadId, a, project),
      { initialProps: { leadId: 'lead-1', agents, project: initialProject } },
    );

    // Snapshot is taken when user is active (elapsed < 60s)
    expect(result.current.catchUpSummary).toBeNull();

    // Advance past 60s without any user interaction
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    // Now rerender with new data that has changed
    const updatedAgents = [
      makeAgent('a1', 'completed', 'lead-1'),
      makeAgent('a2', 'completed', 'lead-1'),
      makeAgent('a3', 'failed', 'lead-1'),
    ];
    const updatedProject = {
      comms: Array.from({ length: 5 }, (_, i) => ({
        id: `c-${i}`, fromId: 'a1', fromRole: 'dev', toId: 'a2', toRole: 'dev',
        content: 'msg', timestamp: Date.now(),
      })),
      decisions: [] as any[],
      agentReports: [] as any[],
    };

    rerender({ leadId: 'lead-1', agents: updatedAgents, project: updatedProject });

    // Should now show catch-up (3 tasks + 5 comms = 8 >= 5 threshold)
    expect(result.current.catchUpSummary).not.toBeNull();
    expect(result.current.catchUpSummary!.tasksCompleted).toBe(3);
    expect(result.current.catchUpSummary!.newMessages).toBe(5);
  });

  it('shows catch-up when pending decisions exist after inactivity', () => {
    const initialProject = { comms: [] as any[], decisions: [] as any[], agentReports: [] as any[] };

    const { result, rerender } = renderHook(
      ({ leadId, agents: a, project }) =>
        useCatchUpSummary(leadId, a, project),
      { initialProps: { leadId: 'lead-1', agents: [] as ReturnType<typeof makeAgent>[], project: initialProject } },
    );

    // Advance past 60s
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    const updatedProject = {
      comms: [] as any[],
      decisions: [makeDecision({ needsConfirmation: true, status: 'recorded' })],
      agentReports: [] as any[],
    };

    rerender({ leadId: 'lead-1', agents: [], project: updatedProject });

    expect(result.current.catchUpSummary).not.toBeNull();
    expect(result.current.catchUpSummary!.pendingDecisions).toBe(1);
  });

  it('dismissCatchUp clears the summary (with user activity reset)', () => {
    const initialProject = { comms: [] as any[], decisions: [] as any[], agentReports: [] as any[] };

    const { result, rerender } = renderHook(
      ({ leadId, agents: a, project }) =>
        useCatchUpSummary(leadId, a, project),
      { initialProps: { leadId: 'lead-1', agents: [] as ReturnType<typeof makeAgent>[], project: initialProject } },
    );

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    const updatedProject = {
      comms: [] as any[],
      decisions: [makeDecision({ needsConfirmation: true, status: 'recorded' })],
      agentReports: [] as any[],
    };

    rerender({ leadId: 'lead-1', agents: [], project: updatedProject });
    expect(result.current.catchUpSummary).not.toBeNull();

    // Simulate user interaction (resets lastInteractionRef) then dismiss
    act(() => {
      window.dispatchEvent(new Event('click'));
      result.current.dismissCatchUp();
    });
    // After dismiss + user activity, the snapshot effect sees elapsed < 60s so doesn't re-trigger
    expect(result.current.catchUpSummary).toBeNull();
  });

  it('resets snapshot when selectedLeadId changes', () => {
    const project = { comms: [] as any[], decisions: [] as any[], agentReports: [] as any[] };

    const { result, rerender } = renderHook(
      ({ leadId }) => useCatchUpSummary(leadId, [], project),
      { initialProps: { leadId: 'lead-1' } },
    );

    expect(result.current.catchUpSummary).toBeNull();

    rerender({ leadId: 'lead-2' });
    expect(result.current.catchUpSummary).toBeNull();
  });

  it('auto-dismisses banner on scroll', () => {
    const initialProject = { comms: [] as any[], decisions: [] as any[], agentReports: [] as any[] };

    const { result, rerender } = renderHook(
      ({ leadId, agents: a, project }) =>
        useCatchUpSummary(leadId, a, project),
      { initialProps: { leadId: 'lead-1', agents: [] as ReturnType<typeof makeAgent>[], project: initialProject } },
    );

    // Create catch-up summary
    act(() => { vi.advanceTimersByTime(61_000); });

    const updatedProject = {
      comms: [] as any[],
      decisions: [makeDecision({ needsConfirmation: true, status: 'recorded' })],
      agentReports: [] as any[],
    };
    rerender({ leadId: 'lead-1', agents: [], project: updatedProject });
    expect(result.current.catchUpSummary).not.toBeNull();

    // Scroll should dismiss
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.catchUpSummary).toBeNull();
  });

  it('click and keydown update last interaction time', () => {
    const project = { comms: [] as any[], decisions: [] as any[], agentReports: [] as any[] };

    renderHook(() => useCatchUpSummary('lead-1', [], project));

    // These should not throw
    act(() => {
      window.dispatchEvent(new Event('click'));
      window.dispatchEvent(new Event('keydown'));
    });
  });
});
