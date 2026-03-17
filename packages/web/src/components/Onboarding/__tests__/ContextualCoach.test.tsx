import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContextualCoach } from '../ContextualCoach';
import { useAppStore } from '../../../stores/appStore';
import type { AgentInfo, Decision } from '../../../types';

// ── localStorage mock ───────────────────────────────────────────────
const storage = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => storage.set(key, val)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
  get length() { return storage.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal('localStorage', mockLocalStorage);

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'dev', name: 'Developer', systemPrompt: '' },
    status: 'running',
    model: 'gpt-4',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    ...overrides,
  } as AgentInfo;
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    agentId: 'agent-1',
    agentRole: 'dev',
    leadId: 'lead-1',
    projectId: 'proj-1',
    title: 'Test decision',
    rationale: '',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: new Date().toISOString(),
    category: 'implementation',
    ...overrides,
  } as Decision;
}

function resetStore(agents: AgentInfo[] = [], pendingDecisions: Decision[] = []) {
  useAppStore.setState({ agents, pendingDecisions });
}

describe('ContextualCoach', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage.clear();
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing initially with no matching tips', () => {
    const { container } = render(<ContextualCoach />);
    // After initial 5s timer fires, still nothing since no trigger matches
    act(() => { vi.advanceTimersByTime(6000); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows context pressure tip when agent has high context usage', () => {
    resetStore([
      makeAgent({
        contextWindowSize: 100_000,
        contextWindowUsed: 90_000,
        projectId: 'proj-1',
      }),
    ]);
    render(<ContextualCoach />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText('Context running low')).toBeInTheDocument();
  });

  it('shows batch approve tip when 5+ pending decisions', () => {
    const decisions = Array.from({ length: 5 }, (_, i) =>
      makeDecision({ id: `d${i}` }),
    );
    resetStore([], decisions);
    render(<ContextualCoach />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText('Batch approve decisions')).toBeInTheDocument();
  });

  it('dismisses tip on dismiss button click and marks as seen', () => {
    resetStore([
      makeAgent({ contextWindowSize: 100_000, contextWindowUsed: 90_000 }),
    ]);
    render(<ContextualCoach />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText('Context running low')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Context running low')).not.toBeInTheDocument();
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'coach-seen-coach-context-pressure',
      'true',
    );
  });

  it('auto-dismisses after 15 seconds', () => {
    resetStore([
      makeAgent({ contextWindowSize: 100_000, contextWindowUsed: 90_000 }),
    ]);
    render(<ContextualCoach />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText('Context running low')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.queryByText('Context running low')).not.toBeInTheDocument();
  });

  it('does not show previously seen tips', () => {
    storage.set('coach-seen-coach-context-pressure', 'true');
    resetStore([
      makeAgent({ contextWindowSize: 100_000, contextWindowUsed: 90_000 }),
    ]);
    render(<ContextualCoach />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByText('Context running low')).not.toBeInTheDocument();
  });

  it('calls onNavigate with /approvals for batch approve CTA', () => {
    const onNavigate = vi.fn();
    const decisions = Array.from({ length: 5 }, (_, i) =>
      makeDecision({ id: `d${i}` }),
    );
    resetStore([], decisions);
    render(<ContextualCoach onNavigate={onNavigate} />);
    act(() => { vi.advanceTimersByTime(6000); });

    fireEvent.click(screen.getByText(/View Queue/));
    expect(onNavigate).toHaveBeenCalledWith('/approvals');
  });

  it('calls onNavigate for compact CTA with pressured agent', () => {
    const onNavigate = vi.fn();
    resetStore([
      makeAgent({
        id: 'a1',
        contextWindowSize: 100_000,
        contextWindowUsed: 90_000,
        projectId: 'proj-1',
      }),
    ]);
    render(<ContextualCoach onNavigate={onNavigate} />);
    act(() => { vi.advanceTimersByTime(6000); });

    fireEvent.click(screen.getByText(/Compact/));
    expect(onNavigate).toHaveBeenCalledWith('/projects/proj-1/session?agent=a1');
  });
});
