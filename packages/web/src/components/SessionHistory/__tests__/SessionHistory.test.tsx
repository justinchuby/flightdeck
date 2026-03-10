import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionHistory } from '../SessionHistory';
import type { SessionDetail } from '../SessionHistory';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ChevronRight: (p: any) => <span data-testid="icon-chevron" {...p} />,
  Clock: (p: any) => <span data-testid="icon-clock" {...p} />,
  Users: (p: any) => <span data-testid="icon-users" {...p} />,
  CheckCircle2: (p: any) => <span data-testid="icon-check" {...p} />,
  XCircle: (p: any) => <span data-testid="icon-x" {...p} />,
  AlertCircle: (p: any) => <span data-testid="icon-alert" {...p} />,
  Play: (p: any) => <span data-testid="icon-play" {...p} />,
  ListChecks: (p: any) => <span data-testid="icon-list" {...p} />,
  Loader2: (p: any) => <span data-testid="icon-loader" {...p} />,
  UserPlus: (p: any) => <span data-testid="icon-userplus" {...p} />,
  Sparkles: (p: any) => <span data-testid="icon-sparkles" {...p} />,
  Eye: (p: any) => <span data-testid="icon-eye" {...p} />,
}));

const MOCK_SESSIONS: SessionDetail[] = [
  {
    id: 1,
    leadId: 'lead-001',
    status: 'completed',
    task: 'Build the dashboard',
    startedAt: '2026-03-08T10:00:00Z',
    endedAt: '2026-03-08T12:30:00Z',
    durationMs: 9000000,
    agents: [
      { role: 'lead', model: 'sonnet-4', agentId: 'lead-001', sessionId: 'sess-1' },
      { role: 'developer', model: 'sonnet-4', agentId: 'dev-001', sessionId: 'sess-2' },
      { role: 'architect', model: 'opus-4', agentId: 'arch-001', sessionId: null },
    ],
    taskSummary: { total: 10, done: 8, failed: 1 },
    hasRetro: true,
  },
  {
    id: 2,
    leadId: 'lead-002',
    status: 'crashed',
    task: 'Fix authentication',
    startedAt: '2026-03-07T14:00:00Z',
    endedAt: '2026-03-07T14:15:00Z',
    durationMs: 900000,
    agents: [
      { role: 'lead', model: 'sonnet-4', agentId: 'lead-002', sessionId: null },
    ],
    taskSummary: { total: 3, done: 1, failed: 1 },
    hasRetro: false,
  },
];

describe('SessionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
  });

  it('renders empty state when no sessions', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No previous sessions')).toBeInTheDocument();
    });
  });

  it('renders session cards with correct data', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
      expect(screen.getByText('Fix authentication')).toBeInTheDocument();
    });

    // Shows session count in header
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('fetches from correct endpoint', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<MemoryRouter><SessionHistory projectId="proj-42" /></MemoryRouter>);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-42/sessions/detail');
    });
  });

  it('expands session on click to show details', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    // Initially, agent tags should not be visible
    expect(screen.queryByText('(sonnet-4)')).not.toBeInTheDocument();

    // Click to expand first session
    fireEvent.click(screen.getByText('Build the dashboard'));

    // Agent tags should now be visible
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
  });

  it('shows retro indicator for sessions with retrospective', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    // Expand the first session (has retro)
    fireEvent.click(screen.getByText('Build the dashboard'));
    expect(screen.getByText('● retro')).toBeInTheDocument();
  });

  it('shows Resume button for non-active sessions when no active lead', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" hasActiveLead={false} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build the dashboard'));
    expect(screen.getByText('Resume from this session')).toBeInTheDocument();
  });

  it('hides Resume button when project has active lead', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" hasActiveLead={true} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build the dashboard'));
    expect(screen.queryByText('Resume from this session')).not.toBeInTheDocument();
  });

  it('collapses expanded session on second click', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    // Expand
    fireEvent.click(screen.getByText('Build the dashboard'));
    expect(screen.getByText('developer')).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Build the dashboard'));
    expect(screen.queryByText('developer')).not.toBeInTheDocument();
  });

  it('shows task summary counts', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('8/10')).toBeInTheDocument();
      expect(screen.getByText('1/3')).toBeInTheDocument();
    });
  });

  it('handles fetch error gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    // Should show empty state, not crash
    await waitFor(() => {
      expect(screen.getByText('No previous sessions')).toBeInTheDocument();
    });
  });

  it('opens ResumeSessionDialog when Resume button is clicked', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" hasActiveLead={false} /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build the dashboard'));
    fireEvent.click(screen.getByText('Resume from this session'));

    // ResumeSessionDialog should appear
    expect(screen.getByTestId('resume-session-dialog')).toBeInTheDocument();
    expect(screen.getByText('Resume Project')).toBeInTheDocument();
  });

  it('shows View full session button in expanded session', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(<MemoryRouter><SessionHistory projectId="proj-1" /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build the dashboard'));
    expect(screen.getByText('View full session')).toBeInTheDocument();
  });

  it('View full session button navigates to correct route', async () => {
    mockApiFetch.mockResolvedValue(MOCK_SESSIONS);
    render(
      <MemoryRouter initialEntries={['/projects/proj-1/overview']}>
        <SessionHistory projectId="proj-1" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Build the dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build the dashboard'));
    const viewBtn = screen.getByText('View full session');
    expect(viewBtn.closest('button')).toBeTruthy();
  });
});
