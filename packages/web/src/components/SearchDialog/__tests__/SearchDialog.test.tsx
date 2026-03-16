import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { SearchDialog } from '../SearchDialog';

function resetStore() {
  useAppStore.setState({
    agents: [
      {
        id: 'agent-abc123',
        role: { id: 'developer', name: 'Developer', systemPrompt: '' },
        status: 'running',
      },
    ] as any[],
    selectedAgentId: null,
  });
}

function makeSearchResponse(results: any[] = []) {
  return {
    query: 'test',
    count: results.length,
    results,
  };
}

describe('SearchDialog', () => {
  beforeEach(() => {
    resetStore();
    mockApiFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Open / Close ─────────────────────────────────────────────────

  it('renders nothing when open is false', () => {
    const { container } = render(<SearchDialog open={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open is true', () => {
    render(<SearchDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search chat history…')).toBeInTheDocument();
  });

  it('shows initial placeholder text', () => {
    render(<SearchDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Search messages, tasks, decisions, and activity')).toBeInTheDocument();
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<SearchDialog open={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<SearchDialog open={true} onClose={onClose} />);

    // Click the outermost overlay container (backdrop)
    const overlay = screen.getByPlaceholderText('Search chat history…').closest('.fixed')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when dialog content is clicked', () => {
    const onClose = vi.fn();
    render(<SearchDialog open={true} onClose={onClose} />);

    // Click the input (inside dialog)
    fireEvent.click(screen.getByPlaceholderText('Search chat history…'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── ESC key label ────────────────────────────────────────────────

  it('shows ESC key hint', () => {
    render(<SearchDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText('ESC')).toBeInTheDocument();
  });

  // ── Search input and results ─────────────────────────────────────

  it('does not search when query is less than 2 characters', async () => {
    render(<SearchDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search chat history…');
    fireEvent.change(input, { target: { value: 'a' } });

    act(() => { vi.advanceTimersByTime(400); });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('searches after debounce when query is >= 2 characters', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search chat history…');
    fireEvent.change(input, { target: { value: 'test query' } });

    // Should not search immediately
    expect(mockApiFetch).not.toHaveBeenCalled();

    // Advance past debounce (300ms)
    await act(async () => { vi.advanceTimersByTime(400); });

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=test%20query'),
    );
  });

  it('shows "Searching…" while loading', async () => {
    // Never-resolving promise to keep loading state
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search chat history…');
    fireEvent.change(input, { target: { value: 'test' } });

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  it('shows "No results" when search returns empty', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search chat history…');
    fireEvent.change(input, { target: { value: 'nothing' } });

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  it('displays conversation results with agent label', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      {
        source: 'conversation',
        id: 1,
        content: 'Hello from an agent about tests',
        timestamp: new Date().toISOString(),
        agentId: 'agent-abc123',
        agentRole: 'Developer',
        sender: 'agent',
      },
    ]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search chat history…');
    // Use a query that won't appear in the content to avoid highlightMatch splitting
    fireEvent.change(input, { target: { value: 'zz' } });

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByText('Developer')).toBeInTheDocument();
    // Content may be split by highlightMatch, so check via container text
    const resultButton = screen.getByText('Developer').closest('button')!;
    expect(resultButton.textContent).toContain('Hello from an agent about tests');
  });

  it('displays task results with status badge', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      {
        source: 'task',
        id: 'task-1',
        content: 'Implement a great feature',
        timestamp: new Date().toISOString(),
        status: 'done',
      },
    ]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Search chat history…'), {
      target: { value: 'zz' },
    });

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByText('Task: task-1')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    const resultButton = screen.getByText('Task: task-1').closest('button')!;
    expect(resultButton.textContent).toContain('Implement a great feature');
  });

  it('displays decision results with rationale', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      {
        source: 'decision',
        id: 'dec-1',
        content: 'Use strict mode always',
        timestamp: new Date().toISOString(),
        agentId: 'agent-abc123',
        agentRole: 'Developer',
        status: 'confirmed',
        rationale: 'Better type safety',
        needsConfirmation: true,
      },
    ]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Search chat history…'), {
      target: { value: 'zz' },
    });

    await act(async () => { vi.advanceTimersByTime(400); });

    // Agent label from the store
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Better type safety')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('displays group results', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      {
        source: 'group',
        id: 'grp-1',
        content: 'Discussion about architecture',
        timestamp: new Date().toISOString(),
        groupName: 'Backend Team',
        fromRole: 'Architect',
      },
    ]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Search chat history…'), {
      target: { value: 'architecture' },
    });

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByText('Backend Team')).toBeInTheDocument();
    expect(screen.getByText('(Architect)')).toBeInTheDocument();
  });

  // ── Clear button ─────────────────────────────────────────────────

  it('shows clear button when query has text and clears on click', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      { source: 'conversation', id: 1, content: 'result', timestamp: null, agentId: null, agentRole: null },
    ]));

    render(<SearchDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search chat history…');
    fireEvent.change(input, { target: { value: 'query' } });

    await act(async () => { vi.advanceTimersByTime(400); });

    // Clear button should exist
    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);

    // Input should be cleared, results gone, placeholder should return
    expect(input).toHaveValue('');
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();
  });

  // ── Result click behavior ────────────────────────────────────────

  it('selects agent and closes on conversation result click', async () => {
    const onClose = vi.fn();
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      {
        source: 'conversation',
        id: 1,
        content: 'Hello from agent',
        timestamp: new Date().toISOString(),
        agentId: 'agent-abc123',
        agentRole: 'Developer',
      },
    ]));

    render(<SearchDialog open={true} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Search chat history…'), {
      target: { value: 'Hello' },
    });

    await act(async () => { vi.advanceTimersByTime(400); });

    // Click on result
    fireEvent.click(screen.getByText('Developer'));

    expect(useAppStore.getState().selectedAgentId).toBe('agent-abc123');
    expect(onClose).toHaveBeenCalled();
  });

  // ── State reset on open ──────────────────────────────────────────

  it('resets query and results when reopened', async () => {
    mockApiFetch.mockResolvedValue(makeSearchResponse([
      { source: 'conversation', id: 1, content: 'old result', timestamp: null },
    ]));

    const { rerender } = render(<SearchDialog open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Search chat history…'), {
      target: { value: 'old search' },
    });
    await act(async () => { vi.advanceTimersByTime(400); });

    // Close
    rerender(<SearchDialog open={false} onClose={vi.fn()} />);

    // Reopen
    rerender(<SearchDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByPlaceholderText('Search chat history…')).toHaveValue('');
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();
  });
});
