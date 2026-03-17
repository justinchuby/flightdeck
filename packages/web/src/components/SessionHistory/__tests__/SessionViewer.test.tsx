// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

  async function renderViewer(props: Partial<Parameters<typeof SessionViewer>[0]> = {}) {
    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <MemoryRouter>
          <SessionViewer session={session} onClose={onClose} onResume={onResume} {...props} />
        </MemoryRouter>
      );
    });
    return result;
  }

  it('renders session summary panel', async () => {
    await renderViewer();
    expect(screen.getByTestId('session-viewer')).toBeInTheDocument();
    expect(screen.getByText('Session Summary')).toBeInTheDocument();
  });

  it('shows task description', async () => {
    await renderViewer();
    expect(screen.getByText('Implement auth module')).toBeInTheDocument();
  });

  it('shows session metadata', async () => {
    await renderViewer();
    expect(screen.getByText(/lead-abc123/)).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows agent count', async () => {
    await renderViewer();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows task summary', async () => {
    await renderViewer();
    expect(screen.getByText(/8\/10/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('fetches message count with limit=200 on mount', async () => {
    await renderViewer();
    await waitFor(() => {
      const call = mockApiFetch.mock.calls[0];
      expect(call[0]).toBe('/agents/lead-abc123/messages?limit=200');
      expect(call[1]).toHaveProperty('signal');
    });
  });

  it('shows View full conversation button when projectId exists', async () => {
    await renderViewer();
    expect(screen.getByTestId('session-viewer-view-full')).toBeInTheDocument();
    expect(screen.getByText('View full conversation')).toBeInTheDocument();
  });

  it('shows Resume button for ended sessions', async () => {
    await renderViewer();
    expect(screen.getByTestId('session-viewer-resume')).toBeInTheDocument();
    expect(screen.getByText('Resume this session')).toBeInTheDocument();
  });

  it('hides Resume button for active sessions', async () => {
    await renderViewer({ session: { ...session, status: 'active' } });
    expect(screen.queryByTestId('session-viewer-resume')).not.toBeInTheDocument();
  });

  it('hides Resume button when onResume not provided', async () => {
    await renderViewer({ onResume: undefined });
    expect(screen.queryByTestId('session-viewer-resume')).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    await renderViewer();
    fireEvent.click(screen.getByTestId('session-viewer-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    await renderViewer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onResume and onClose when Resume clicked', async () => {
    await renderViewer();
    fireEvent.click(screen.getByTestId('session-viewer-resume'));
    expect(onClose).toHaveBeenCalled();
    expect(onResume).toHaveBeenCalled();
  });
});
