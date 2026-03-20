import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Stub clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

import { ShareDialog } from '../ShareDialog';

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseLink = {
  token: 'abc-token-123',
  leadId: 'lead-1',
  createdAt: '2026-03-20T12:00:00Z',
  expiresAt: '2026-12-31T00:00:00Z',
  label: 'Demo link',
  accessCount: 5,
};

const expiredLink = {
  ...baseLink,
  token: 'expired-token',
  label: 'Old link',
  expiresAt: '2020-01-01T00:00:00Z',
  accessCount: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ShareDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('renders dialog with create form', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    expect(screen.getByText('Share Replay')).toBeInTheDocument();
    expect(screen.getByText('Create Link')).toBeInTheDocument();
    expect(screen.getByTestId('share-label-input')).toBeInTheDocument();
    expect(screen.getByTestId('share-expiry-select')).toBeInTheDocument();
  });

  it('fetches existing share links on mount', async () => {
    mockApiFetch.mockResolvedValue([baseLink]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    expect(mockApiFetch).toHaveBeenCalledWith('/replay/lead-1/shares');
    await waitFor(() => {
      expect(screen.getByTestId('share-link-row')).toBeInTheDocument();
    });
  });

  it('shows empty state when no active links', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('share-empty')).toBeInTheDocument();
    });
  });

  it('filters out expired links', async () => {
    mockApiFetch.mockResolvedValue([expiredLink]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('share-empty')).toBeInTheDocument();
    });
  });

  it('shows loading state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    expect(screen.getByTestId('share-loading')).toBeInTheDocument();
  });

  it('creates a share link and adds it to the list', async () => {
    mockApiFetch
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce(baseLink); // create

    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    const createBtn = screen.getByTestId('share-create-btn');
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/replay/lead-1/share', expect.objectContaining({
      method: 'POST',
    }));

    await waitFor(() => {
      expect(screen.getByTestId('share-link-row')).toBeInTheDocument();
    });
  });

  it('sends label and expiry when creating', async () => {
    mockApiFetch
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce(baseLink); // create

    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    // Type a label
    const labelInput = screen.getByTestId('share-label-input');
    fireEvent.change(labelInput, { target: { value: 'My demo' } });

    // Change expiry to 24h
    const expirySelect = screen.getByTestId('share-expiry-select');
    fireEvent.change(expirySelect, { target: { value: '24' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('share-create-btn'));
    });

    const callBody = JSON.parse(mockApiFetch.mock.calls[1][1].body as string);
    expect(callBody.label).toBe('My demo');
    expect(callBody.expiresInHours).toBe(24);
  });

  it('sends large expiresInHours for "Never" option', async () => {
    mockApiFetch
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce(baseLink); // create

    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    const expirySelect = screen.getByTestId('share-expiry-select');
    fireEvent.change(expirySelect, { target: { value: '876000' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('share-create-btn'));
    });

    const callBody = JSON.parse(mockApiFetch.mock.calls[1][1].body as string);
    expect(callBody.expiresInHours).toBe(876000);
  });

  it('always sends expiresInHours with default value', async () => {
    mockApiFetch
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce(baseLink); // create

    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId('share-create-btn'));
    });

    const callBody = JSON.parse(mockApiFetch.mock.calls[1][1].body as string);
    expect(callBody.expiresInHours).toBe(168); // default 7 days
  });

  it('copies link to clipboard on copy button click', async () => {
    mockApiFetch.mockResolvedValue([baseLink]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await waitFor(() => screen.getByTestId('share-copy-btn'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('share-copy-btn'));
    });

    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('/shared/abc-token-123'),
    );
  });

  it('revokes a share link', async () => {
    mockApiFetch
      .mockResolvedValueOnce([baseLink]) // initial fetch
      .mockResolvedValueOnce({ revoked: true }); // delete

    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await waitFor(() => screen.getByTestId('share-revoke-btn'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('share-revoke-btn'));
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/shared/abc-token-123', { method: 'DELETE' });

    await waitFor(() => {
      expect(screen.queryByTestId('share-link-row')).not.toBeInTheDocument();
    });
  });

  it('shows error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('share-error')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('closes on ESC key', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    const backdrop = screen.getByTestId('share-dialog-backdrop');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Done button click', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays link label and access count', async () => {
    mockApiFetch.mockResolvedValue([baseLink]);
    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText('Demo link')).toBeInTheDocument();
      expect(screen.getByText('5 views')).toBeInTheDocument();
    });
  });

  it('auto-copies link after creation', async () => {
    mockApiFetch
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce(baseLink); // create

    render(<ShareDialog leadId="lead-1" onClose={onClose} />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId('share-create-btn'));
    });

    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('/shared/abc-token-123'),
    );
  });
});
