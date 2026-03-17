// @vitest-environment jsdom
/**
 * Coverage tests for SessionHistory — expand/collapse, resume dialog, loading/empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/format', () => ({
  formatDateTime: (s: string) => s,
  formatDuration: (ms: number | null) => (ms ? `${Math.round(ms / 1000)}s` : '—'),
}));

vi.mock('../ResumeSessionDialog', () => ({
  ResumeSessionDialog: ({ onClose }: any) => (
    <div data-testid="resume-dialog">
      <button onClick={onClose}>Close Resume</button>
    </div>
  ),
}));

import { SessionHistory } from '../SessionHistory';

const makeSession = (overrides: any = {}) => ({
  id: 1,
  leadId: 'lead-abc12345',
  status: 'completed',
  task: 'Build a feature',
  startedAt: '2024-01-01T00:00:00Z',
  endedAt: '2024-01-01T01:00:00Z',
  durationMs: 3600000,
  agents: [{ role: 'developer', model: 'gpt-4', agentId: 'a1', sessionId: 's1', provider: 'openai' }],
  taskSummary: { total: 5, done: 3, failed: 1 },
  hasRetro: false,
  ...overrides,
});

describe('SessionHistory — coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No previous sessions')).toBeInTheDocument();
    });
  });

  it('renders session cards', async () => {
    mockApiFetch.mockResolvedValue([makeSession()]);
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Build a feature')).toBeInTheDocument();
    });
    expect(screen.getByText('(1)')).toBeInTheDocument(); // session count
  });

  it('expands and collapses session', async () => {
    mockApiFetch.mockResolvedValue([makeSession()]);
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Build a feature')).toBeInTheDocument();
    });

    // Expand
    fireEvent.click(screen.getByText('Build a feature'));
    expect(screen.getByText('View full session')).toBeInTheDocument();
    expect(screen.getByText(/developer/)).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText('Build a feature'));
    expect(screen.queryByText('View full session')).not.toBeInTheDocument();
  });

  it('shows resume button when no active lead', async () => {
    mockApiFetch.mockResolvedValue([makeSession()]);
    render(<MemoryRouter><SessionHistory projectId="p1" hasActiveLead={false} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Build a feature')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build a feature'));
    expect(screen.getByText('Resume from this session')).toBeInTheDocument();
  });

  it('hides resume button when active lead exists', async () => {
    mockApiFetch.mockResolvedValue([makeSession()]);
    render(<MemoryRouter><SessionHistory projectId="p1" hasActiveLead={true} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Build a feature')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build a feature'));
    expect(screen.queryByText('Resume from this session')).not.toBeInTheDocument();
  });

  it('shows retro indicator when session has retro', async () => {
    mockApiFetch.mockResolvedValue([makeSession({ hasRetro: true })]);
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Build a feature')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Build a feature'));
    expect(screen.getByText('● retro')).toBeInTheDocument();
  });

  it('shows "No task description" for sessions without task', async () => {
    mockApiFetch.mockResolvedValue([makeSession({ task: null })]);
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No task description')).toBeInTheDocument();
    });
  });

  it('opens resume dialog and can close it', async () => {
    mockApiFetch.mockResolvedValue([makeSession()]);
    render(<MemoryRouter><SessionHistory projectId="p1" hasActiveLead={false} /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Build a feature')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Build a feature'));
    fireEvent.click(screen.getByText('Resume from this session'));
    expect(screen.getByTestId('resume-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close Resume'));
    await waitFor(() => {
      expect(screen.queryByTestId('resume-dialog')).not.toBeInTheDocument();
    });
  });

  it('handles fetch error silently', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));
    render(<MemoryRouter><SessionHistory projectId="p1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('No previous sessions')).toBeInTheDocument();
    });
  });
});
