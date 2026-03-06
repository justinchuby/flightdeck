// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

import { DataManagement } from '../Settings/DataManagement';

const MOCK_STATS = {
  fileSizeBytes: 2_500_000,
  tableCounts: {
    projects: 3,
    project_sessions: 5,
    activity_log: 120,
    dag_tasks: 27,
    chat_groups: 4,
    chat_group_messages: 56,
    conversations: 8,
    messages: 200,
    agent_memory: 15,
    decisions: 3,
    collective_memory: 10,
  },
  totalRecords: 451,
  oldestSession: '2025-01-15T10:30:00Z',
};

const MOCK_PREVIEW = {
  deleted: { project_sessions: 2, activity_log: 40, dag_tasks: 8 },
  totalDeleted: 50,
  sessionsDeleted: 2,
  dryRun: true,
  cutoffDate: '2025-02-01T00:00:00.000Z',
};

describe('DataManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders stats on load', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_STATS);
    render(<DataManagement />);

    await waitFor(() => {
      expect(screen.getByText('Data Management')).toBeInTheDocument();
    });

    // Should show database size
    await waitFor(() => {
      expect(screen.getByText('2.4 MB')).toBeInTheDocument();
    });

    // Should show total records
    expect(screen.getByText('451')).toBeInTheDocument();

    // Should show oldest session date (format varies by locale)
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it('shows error on fetch failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network down'));
    render(<DataManagement />);

    await waitFor(() => {
      expect(screen.getByText('Network down')).toBeInTheDocument();
    });
  });

  it('shows preview when Preview button clicked', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_STATS);
    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('451')).toBeInTheDocument());

    mockApiFetch.mockResolvedValueOnce(MOCK_PREVIEW);
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => {
      expect(screen.getByText(/2 session\(s\) and 50 total records will be permanently deleted/)).toBeInTheDocument();
    });

    // Should show the delete button
    expect(screen.getByText('Permanently Delete')).toBeInTheDocument();
  });

  it('shows no-data message when nothing to delete', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_STATS);
    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('451')).toBeInTheDocument());

    mockApiFetch.mockResolvedValueOnce({
      deleted: {},
      totalDeleted: 0,
      sessionsDeleted: 0,
      dryRun: true,
      cutoffDate: '2025-02-01T00:00:00.000Z',
    });
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => {
      expect(screen.getByText(/No sessions found older than/)).toBeInTheDocument();
    });
  });

  it('executes purge and shows result', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_STATS);
    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('451')).toBeInTheDocument());

    // Preview first
    mockApiFetch.mockResolvedValueOnce(MOCK_PREVIEW);
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Permanently Delete')).toBeInTheDocument());

    // Execute purge
    const purgeResult = { ...MOCK_PREVIEW, dryRun: false };
    mockApiFetch.mockResolvedValueOnce(purgeResult); // purge
    mockApiFetch.mockResolvedValueOnce({ ...MOCK_STATS, totalRecords: 401 }); // refresh

    fireEvent.click(screen.getByText('Permanently Delete'));

    await waitFor(() => {
      expect(screen.getByText(/Deleted 50 records from 2 session/)).toBeInTheDocument();
    });
  });

  it('sends correct days param to API', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_STATS);
    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('451')).toBeInTheDocument());

    // Change dropdown to 90 days
    const select = screen.getByDisplayValue('30 days');
    fireEvent.change(select, { target: { value: '90' } });

    mockApiFetch.mockResolvedValueOnce(MOCK_PREVIEW);
    fireEvent.click(screen.getByText('Preview'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/data/cleanup', expect.objectContaining({
        body: JSON.stringify({ olderThanDays: 90, dryRun: true }),
      }));
    });
  });
});
