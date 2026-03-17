// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CwdBar } from '../CwdBar';

const mockUpdateAgent = vi.fn();
const mockApiFetch = vi.fn().mockResolvedValue({});

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: any) => selector({ updateAgent: mockUpdateAgent }),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

describe('CwdBar', () => {
  it('shows cwd text', () => {
    render(<CwdBar leadId="lead-1" cwd="/home/project" />);
    expect(screen.getByText('/home/project')).toBeInTheDocument();
  });

  it('shows "(server default)" when no cwd', () => {
    render(<CwdBar leadId="lead-1" />);
    expect(screen.getByText('(server default)')).toBeInTheDocument();
  });

  it('clicking edit shows input', () => {
    render(<CwdBar leadId="lead-1" cwd="/home/project" />);
    fireEvent.click(screen.getByText('edit'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('/home/project');
  });

  it('saving calls apiFetch with PATCH', async () => {
    render(<CwdBar leadId="lead-1" cwd="/old" />);
    fireEvent.click(screen.getByText('edit'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/new/path' } });
    fireEvent.click(screen.getByLabelText('Save working directory'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead/lead-1', {
        method: 'PATCH',
        body: JSON.stringify({ cwd: '/new/path' }),
      });
    });
    expect(mockUpdateAgent).toHaveBeenCalledWith('lead-1', { cwd: '/new/path' });
  });

  it('pressing Escape cancels edit', () => {
    render(<CwdBar leadId="lead-1" cwd="/home/project" />);
    fireEvent.click(screen.getByText('edit'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('pressing Enter saves', async () => {
    render(<CwdBar leadId="lead-1" cwd="/home/project" />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });
});
