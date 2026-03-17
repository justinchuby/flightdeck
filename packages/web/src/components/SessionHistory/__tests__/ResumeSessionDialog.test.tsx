import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResumeSessionDialog } from '../ResumeSessionDialog';
import type { SessionDetail } from '../SessionHistory';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('lucide-react', () => ({
  Play: (p: any) => <span data-testid="icon-play" {...p} />,
  Loader2: (p: any) => <span data-testid="icon-loader" {...p} />,
  Users: (p: any) => <span data-testid="icon-users" {...p} />,
  UserPlus: (p: any) => <span data-testid="icon-userplus" {...p} />,
  Sparkles: (p: any) => <span data-testid="icon-sparkles" {...p} />,
  CheckCircle2: (p: any) => <span data-testid="icon-check" {...p} />,
  AlertTriangle: (p: any) => <span data-testid="icon-alert" {...p} />,
  Plus: (p: any) => <span data-testid="icon-plus" {...p} />,
  Bug: (p: any) => <span data-testid="icon-bug" {...p} />,
  ExternalLink: (p: any) => <span data-testid="icon-external" {...p} />,
}));

const MOCK_SESSION: SessionDetail = {
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
    { role: 'code-reviewer', model: 'haiku-4', agentId: 'cr-001', sessionId: 'sess-4' },
  ],
  taskSummary: { total: 10, done: 8, failed: 1 },
  hasRetro: true,
};

describe('ResumeSessionDialog', () => {
  const defaultProps = {
    projectId: 'proj-1',
    lastSession: MOCK_SESSION,
    onClose: vi.fn(),
    onResume: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dialog with session info', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    expect(screen.getByText('Resume Project')).toBeInTheDocument();
    expect(screen.getByText(/8\/10 tasks completed/)).toBeInTheDocument();
  });

  it('shows three resume modes', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    expect(screen.getByText('Resume all agents')).toBeInTheDocument();
    expect(screen.getByText('Select specific agents')).toBeInTheDocument();
    expect(screen.getByText('Fresh start')).toBeInTheDocument();
  });

  it('defaults to resume-all mode', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    // Agent checkboxes should NOT be visible by default
    expect(screen.queryByText('Select agents to resume (lead always included):')).not.toBeInTheDocument();
  });

  it('shows agent checkboxes when select mode is chosen', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    fireEvent.click(screen.getByText('Select specific agents'));

    // Should show non-lead agents as checkboxes
    expect(screen.getByText('Select agents to resume (lead always included):')).toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText('code-reviewer')).toBeInTheDocument();
  });

  it('shows resumable indicator for agents with sessionId', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    fireEvent.click(screen.getByText('Select specific agents'));

    // developer and code-reviewer have sessionIds
    const resumableLabels = screen.getAllByText('resumable');
    expect(resumableLabels).toHaveLength(2);
  });

  it('calls resume endpoint with resume-all mode', async () => {
    mockApiFetch.mockResolvedValue({ id: 'new-lead' });
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);

    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/resume', {
        method: 'POST',
        body: JSON.stringify({
          task: undefined,
          freshStart: false,
          resumeAll: true,
          agents: undefined,
          sessionId: 1,
        }),
      });
    });
    expect(defaultProps.onResume).toHaveBeenCalled();
  });

  it('calls resume endpoint with fresh-start mode', async () => {
    mockApiFetch.mockResolvedValue({ id: 'new-lead' });
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);

    fireEvent.click(screen.getByText('Fresh start'));
    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/resume', {
        method: 'POST',
        body: JSON.stringify({
          task: undefined,
          freshStart: true,
          resumeAll: false,
          agents: undefined,
          sessionId: 1,
        }),
      });
    });
  });

  it('calls resume endpoint with selected agents', async () => {
    mockApiFetch.mockResolvedValue({ id: 'new-lead' });
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);

    // Switch to select mode
    fireEvent.click(screen.getByText('Select specific agents'));

    // Uncheck architect (no sessionId)
    const checkboxes = screen.getAllByRole('checkbox');
    // Find the architect checkbox — all are checked by default
    // Agents shown: developer, architect, code-reviewer (non-lead)
    fireEvent.click(checkboxes[1]); // uncheck architect

    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.agents).not.toContain('arch-001');
      expect(body.agents).toContain('dev-001');
      expect(body.agents).toContain('cr-001');
      // Lead should never be in agents array
      expect(body.agents).not.toContain('lead-001');
    });
  });

  it('sends task override when provided', async () => {
    mockApiFetch.mockResolvedValue({ id: 'new-lead' });
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);

    const textarea = screen.getByPlaceholderText('Continue previous work…');
    fireEvent.change(textarea, { target: { value: 'New task instructions' } });

    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.task).toBe('New task instructions');
    });
  });

  it('shows error message on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Rate limit exceeded'));
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);

    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
    });
    expect(defaultProps.onResume).not.toHaveBeenCalled();
  });

  it('closes when Cancel is clicked', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('closes when clicking outside the dialog', () => {
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);
    const overlay = screen.getByTestId('resume-session-dialog');
    fireEvent.mouseDown(overlay);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('disables Resume button while resuming', async () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MemoryRouter><ResumeSessionDialog {...defaultProps} /></MemoryRouter>);

    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      expect(screen.getByText('Resuming…')).toBeInTheDocument();
    });
  });
});
