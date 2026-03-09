// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionViewer } from '../SessionViewer';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

const session = {
  leadId: 'lead-abc123',
  task: 'Implement auth module',
  startedAt: '2026-03-09T10:00:00Z',
  endedAt: '2026-03-09T12:30:00Z',
  projectId: 'proj-1',
  status: 'completed' as const,
  agentCount: 4,
  taskSummary: { total: 10, done: 8, failed: 1 },
};

describe('SessionViewer', () => {
  const onClose = vi.fn();
  const onResume = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ messages: [{ id: 1 }] });
  });

  function renderViewer(props: Partial<Parameters<typeof SessionViewer>[0]> = {}) {
    return render(
      <MemoryRouter>
        <SessionViewer session={session} onClose={onClose} onResume={onResume} {...props} />
      </MemoryRouter>
    );
  }

  it('renders session summary panel', () => {
    renderViewer();
    expect(screen.getByTestId('session-viewer')).toBeInTheDocument();
    expect(screen.getByText('Session Summary')).toBeInTheDocument();
  });

  it('shows task description', () => {
    renderViewer();
    expect(screen.getByText('Implement auth module')).toBeInTheDocument();
  });

  it('shows session metadata', () => {
    renderViewer();
    expect(screen.getByText(/lead-abc123/)).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows agent count', () => {
    renderViewer();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows task summary', () => {
    renderViewer();
    expect(screen.getByText(/8\/10/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('fetches message count with limit=200 on mount', async () => {
    renderViewer();
    await waitFor(() => {
      const call = mockApiFetch.mock.calls[0];
      expect(call[0]).toBe('/agents/lead-abc123/messages?limit=200');
      expect(call[1]).toHaveProperty('signal');
    });
  });

  it('shows View full conversation button when projectId exists', () => {
    renderViewer();
    expect(screen.getByTestId('session-viewer-view-full')).toBeInTheDocument();
    expect(screen.getByText('View full conversation')).toBeInTheDocument();
  });

  it('shows Resume button for ended sessions', () => {
    renderViewer();
    expect(screen.getByTestId('session-viewer-resume')).toBeInTheDocument();
    expect(screen.getByText('Resume this session')).toBeInTheDocument();
  });

  it('hides Resume button for active sessions', () => {
    renderViewer({ session: { ...session, status: 'active' } });
    expect(screen.queryByTestId('session-viewer-resume')).not.toBeInTheDocument();
  });

  it('hides Resume button when onResume not provided', () => {
    renderViewer({ onResume: undefined });
    expect(screen.queryByTestId('session-viewer-resume')).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    renderViewer();
    fireEvent.click(screen.getByTestId('session-viewer-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    renderViewer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onResume and onClose when Resume clicked', () => {
    renderViewer();
    fireEvent.click(screen.getByTestId('session-viewer-resume'));
    expect(onClose).toHaveBeenCalled();
    expect(onResume).toHaveBeenCalled();
  });
});
