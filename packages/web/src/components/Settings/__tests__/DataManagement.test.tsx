// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DataManagement } from '../DataManagement';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const defaultStats = {
  fileSizeBytes: 5242880,
  tableCounts: { projects: 10, messages: 500, activity_log: 200 },
  totalRecords: 710,
  oldestSession: '2025-06-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockResolvedValue(defaultStats);
});
afterEach(cleanup);

describe('DataManagement', () => {
  it('renders Data Management heading', async () => {
    render(<DataManagement />);
    expect(screen.getByText('Data Management')).toBeDefined();
  });

  it('fetches and shows database stats on mount', async () => {
    render(<DataManagement />);
    await waitFor(() => {
      expect(screen.getByText('5.0 MB')).toBeDefined();
      expect(screen.getByText('710')).toBeDefined();
    });
  });

  it('shows oldest session date', async () => {
    render(<DataManagement />);
    await waitFor(() => {
      expect(screen.getByText('Oldest Session')).toBeDefined();
    });
  });

  it('shows error when API fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<DataManagement />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });

  it('renders period selector', async () => {
    render(<DataManagement />);
    await waitFor(() => {
      expect(screen.getByText('Preview')).toBeDefined();
    });
  });

  it('shows preview results after clicking Preview', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats)
      .mockResolvedValueOnce({
        deleted: { messages: 100, activity_log: 50 },
        totalDeleted: 150,
        sessionsDeleted: 3,
        dryRun: true,
        cutoffDate: '2025-12-01T00:00:00Z',
      });

    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('Preview')).toBeDefined());
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => {
      expect(screen.getByText(/150 total records/)).toBeDefined();
      expect(screen.getByText('Permanently Delete')).toBeDefined();
    });
  });

  it('shows success after purge', async () => {
    mockApiFetch
      .mockResolvedValueOnce(defaultStats) // initial load
      .mockResolvedValueOnce({ deleted: {}, totalDeleted: 150, sessionsDeleted: 3, dryRun: true, cutoffDate: '' }) // preview
      .mockResolvedValueOnce({ deleted: {}, totalDeleted: 150, sessionsDeleted: 3, dryRun: false, cutoffDate: '' }) // purge
      .mockResolvedValueOnce(defaultStats); // refresh

    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('Preview')).toBeDefined());
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Permanently Delete')).toBeDefined());
    fireEvent.click(screen.getByText('Permanently Delete'));
    await waitFor(() => {
      expect(screen.getByText(/Deleted 150 records/)).toBeDefined();
    });
  });

  it('has Refresh button', () => {
    render(<DataManagement />);
    expect(screen.getByText('Refresh')).toBeDefined();
  });

  it('shows warning for "All data" option', async () => {
    render(<DataManagement />);
    await waitFor(() => expect(screen.getByText('Preview')).toBeDefined());
    const select = screen.getByDisplayValue('30 days');
    fireEvent.change(select, { target: { value: '0' } });
    expect(screen.getByText(/delete ALL session data/)).toBeDefined();
  });
});
