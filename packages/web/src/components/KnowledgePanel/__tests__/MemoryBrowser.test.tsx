import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryBrowser } from '../MemoryBrowser';

// ── Mocks ─────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

// ── Fixtures ──────────────────────────────────────────────────────

const sampleEntries = [
  { id: 1, key: 'api-pattern', value: 'Use REST for external, gRPC for internal', agentId: 'agent-001', createdAt: '2025-01-01' },
  { id: 2, key: 'test-strategy', value: 'Unit tests for utils, integration for API', agentId: 'agent-002', createdAt: '2025-01-02' },
];

const sampleStats = { memory: 2 };

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe('MemoryBrowser', () => {
  it('shows loading spinner initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MemoryBrowser />);
    // Loading spinner is a div with animate-spin
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('renders memory entries after loading', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText('api-pattern')).toBeTruthy();
      expect(screen.getByText('test-strategy')).toBeTruthy();
    });
  });

  it('shows entry count in header', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText('2 memory entries')).toBeTruthy();
    });
  });

  it('shows singular "entry" when count is 1', async () => {
    mockApiFetch
      .mockResolvedValueOnce([sampleEntries[0]])
      .mockResolvedValueOnce({ memory: 1 });

    render(<MemoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText('1 memory entry')).toBeTruthy();
    });
  });

  it('shows empty state when no entries', async () => {
    mockApiFetch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ memory: 0 });

    render(<MemoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText('No memory entries yet.')).toBeTruthy();
    });
  });

  it('displays entry values', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);

    await waitFor(() => {
      expect(screen.getByText('Use REST for external, gRPC for internal')).toBeTruthy();
    });
  });

  it('shows agent ID on entries', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);

    await waitFor(() => {
      const agentIds = screen.getAllByText('agent-00');
      expect(agentIds.length).toBe(2); // one per entry
    });
  });

  it('deletes entry when delete button is clicked', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);

    await waitFor(() => screen.getByText('api-pattern'));

    // Delete button calls /db/memory/:id
    mockApiFetch.mockResolvedValueOnce({});
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/db/memory/1', { method: 'DELETE' });
    });

    // Entry should be removed from the list
    await waitFor(() => {
      expect(screen.queryByText('api-pattern')).toBeNull();
    });
  });

  it('decrements count after deletion', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);
    await waitFor(() => screen.getByText('2 memory entries'));

    mockApiFetch.mockResolvedValueOnce({});
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('1 memory entry')).toBeTruthy();
    });
  });

  it('refreshes data when refresh button is clicked', async () => {
    mockApiFetch
      .mockResolvedValueOnce(sampleEntries)
      .mockResolvedValueOnce(sampleStats);

    render(<MemoryBrowser />);
    await waitFor(() => screen.getByText('api-pattern'));

    const updatedEntries = [...sampleEntries, { id: 3, key: 'new-entry', value: 'new', agentId: null, createdAt: '2025-01-03' }];
    mockApiFetch
      .mockResolvedValueOnce(updatedEntries)
      .mockResolvedValueOnce({ memory: 3 });

    fireEvent.click(screen.getByTitle('Refresh'));

    await waitFor(() => {
      expect(screen.getByText('3 memory entries')).toBeTruthy();
    });
  });
});
