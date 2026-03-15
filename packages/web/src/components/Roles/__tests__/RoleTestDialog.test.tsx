// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { RoleTestDialog } from '../RoleTestDialog';

const testRole = {
  name: 'Developer',
  icon: '👨‍💻',
  model: 'claude-3',
  systemPrompt: 'You are a developer.',
  description: 'Writes code',
  color: '#0066ff',
};

describe('RoleTestDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('renders dialog with role name and icon', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    expect(screen.getByText(/Test: Developer/)).toBeInTheDocument();
    expect(screen.getByText('👨‍💻')).toBeInTheDocument();
  });

  it('renders default test message in textarea', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Hello, introduce yourself and describe your capabilities.');
  });

  it('calls onClose when ✕ button is clicked', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    // The outer div is the backdrop
    const backdrop = screen.getByText(/Test: Developer/).closest('.fixed');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when inner dialog is clicked', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    const inner = screen.getByText(/Test: Developer/).closest('.relative');
    fireEvent.click(inner!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends test message and displays response', async () => {
    mockApiFetch.mockResolvedValue({ response: 'Hello! I am the developer role.' });
    render(<RoleTestDialog role={testRole} onClose={onClose} />);

    fireEvent.click(screen.getByText('Send Test Message'));

    await waitFor(() => {
      expect(screen.getByText('Hello! I am the developer role.')).toBeInTheDocument();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/roles/test', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('shows error message on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<RoleTestDialog role={testRole} onClose={onClose} />);

    fireEvent.click(screen.getByText('Send Test Message'));

    await waitFor(() => {
      expect(screen.getByText('Test failed — check your configuration.')).toBeInTheDocument();
    });
  });

  it('disables send button while loading', async () => {
    let resolvePromise: (v: any) => void;
    mockApiFetch.mockReturnValue(new Promise((r) => { resolvePromise = r; }));
    render(<RoleTestDialog role={testRole} onClose={onClose} />);

    fireEvent.click(screen.getByText('Send Test Message'));
    expect(screen.getByText('Running test…')).toBeInTheDocument();
    expect(screen.getByText('Running test…').closest('button')).toBeDisabled();

    resolvePromise!({ response: 'done' });
    await waitFor(() => expect(screen.getByText('Send Test Message')).toBeInTheDocument());
  });

  it('disables send button when message is empty', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '' } });
    expect(screen.getByText('Send Test Message').closest('button')).toBeDisabled();
  });
});
