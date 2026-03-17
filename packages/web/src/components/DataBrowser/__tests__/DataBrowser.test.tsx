import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../Shared', () => ({
  SkeletonCard: ({ lines }: { lines?: number }) => (
    <div data-testid="skeleton-card">skeleton-{lines ?? 3}</div>
  ),
  SkeletonList: () => <div data-testid="skeleton-list" />,
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({
    tabs,
    activeTab,
    onTabChange,
  }: {
    tabs: Array<{ id: string; label: string }>;
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
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

import { DataBrowser } from '../DataBrowser';

// ── Helpers ─────────────────────────────────────────────────────────

const defaultStats = {
  memory: 5,
  conversations: 3,
  messages: 42,
  decisions: 7,
  activity: 12,
  dagTasks: 4,
};

// ── Tests ───────────────────────────────────────────────────────────

describe('DataBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(defaultStats);
  });

  it('renders the main heading and refresh button', async () => {
    render(<DataBrowser />);
    await act(async () => {});
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByLabelText('Refresh database stats')).toBeInTheDocument();
  });

  it('renders tabs with correct labels', async () => {
    render(<DataBrowser />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-stats')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-memory')).toBeInTheDocument();
    expect(screen.getByTestId('tab-conversations')).toBeInTheDocument();
    expect(screen.getByTestId('tab-decisions')).toBeInTheDocument();
    expect(screen.getByTestId('tab-activity')).toBeInTheDocument();
  });

  it('shows stats overview cards when data loads', async () => {
    render(<DataBrowser />);

    // Stats should display the card values
    expect(await screen.findByText('5')).toBeInTheDocument(); // memory
    expect(screen.getByText('3')).toBeInTheDocument(); // conversations
    expect(screen.getByText('42')).toBeInTheDocument(); // messages
    expect(screen.getByText('7')).toBeInTheDocument(); // decisions
    expect(screen.getByText('12')).toBeInTheDocument(); // activity
    expect(screen.getByText('4')).toBeInTheDocument(); // dagTasks

    // Card labels (some also appear as tab labels, so use getAllByText)
    expect(screen.getByText('Memory Entries')).toBeInTheDocument();
    expect(screen.getAllByText('Conversations').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getAllByText('Decisions').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Activity Events')).toBeInTheDocument();
    expect(screen.getByText('DAG Tasks')).toBeInTheDocument();
  });

  it('shows skeleton when stats have not loaded', () => {
    // Never resolve the fetch
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<DataBrowser />);
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });

  it('switches to memory tab and shows loading then content', async () => {
    // First call returns stats, second returns memory rows
    mockApiFetch
      .mockResolvedValueOnce(defaultStats) // stats
      .mockResolvedValueOnce([             // memory rows
        { id: 1, key: 'test-key', value: 'test-value', agentId: 'agent-abc12345', leadId: 'lead-xyz12345', createdAt: '2024-01-01' },
      ]);

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    // Switch to memory tab
    await act(async () => { fireEvent.click(screen.getByTestId('tab-memory')); });

    // Should show memory entry
    expect(await screen.findByText('test-key')).toBeInTheDocument();
    expect(screen.getByText('test-value')).toBeInTheDocument();
  });

  it('shows empty state for memory tab', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats) // stats
      .mockResolvedValueOnce([]);            // empty memory

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('tab-memory')); });
    expect(await screen.findByText('No memory entries yet')).toBeInTheDocument();
  });

  it('switches to decisions tab and displays rows', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats) // stats
      .mockResolvedValueOnce([             // decision rows
        {
          id: 'd1',
          title: 'Use TypeScript',
          status: 'confirmed',
          agentId: 'agent-abc12345',
          agentRole: 'architect',
          createdAt: '2024-01-01',
        },
      ]);

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('tab-decisions')); });
    expect(await screen.findByText('Use TypeScript')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('shows empty state for decisions tab', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats)
      .mockResolvedValueOnce([]);

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('tab-decisions')); });
    expect(await screen.findByText('No decisions recorded')).toBeInTheDocument();
  });

  it('switches to activity tab and displays rows', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats)
      .mockResolvedValueOnce([
        { id: 1, agentRole: 'worker', actionType: 'progress_update', summary: 'Built feature X', timestamp: '2024-01-01T12:30:00Z' },
      ]);

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('tab-activity')); });
    expect(await screen.findByText('Built feature X')).toBeInTheDocument();
    expect(screen.getByText('progress_update')).toBeInTheDocument();
  });

  it('shows empty state for activity tab', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats)
      .mockResolvedValueOnce([]);

    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('tab-activity')); });
    expect(await screen.findByText('No activity recorded')).toBeInTheDocument();
  });

  it('refreshes stats when refresh button is clicked', async () => {
    render(<DataBrowser />);
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());

    const updatedStats = { ...defaultStats, memory: 99 };
    mockApiFetch.mockResolvedValueOnce(updatedStats);

    await act(async () => { fireEvent.click(screen.getByLabelText('Refresh database stats')); });

    expect(await screen.findByText('99')).toBeInTheDocument();
  });
});
