import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FileTree } from '../FileTree';

// ── Mocks ─────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────────────

const rootFiles = {
  path: '',
  items: [
    { name: 'src', path: 'src', type: 'directory' as const },
    { name: 'README.md', path: 'README.md', type: 'file' as const, ext: 'md' },
    { name: 'index.ts', path: 'index.ts', type: 'file' as const, ext: 'ts' },
  ],
};

const srcFiles = {
  path: 'src',
  items: [
    { name: 'main.py', path: 'src/main.py', type: 'file' as const, ext: 'py' },
    { name: 'config.json', path: 'src/config.json', type: 'file' as const, ext: 'json' },
  ],
};

const defaultProps = {
  projectId: 'proj-1',
  selectedPath: null,
  onSelectFile: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiFetch.mockReset();
  defaultProps.onSelectFile = vi.fn();
});

describe('FileTree', () => {
  it('shows loading state initially', async () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<FileTree {...defaultProps} />);
    await act(async () => {});
    expect(screen.getByText('Loading files…')).toBeTruthy();
  });

  it('renders root entries after loading', async () => {
    mockApiFetch.mockResolvedValue(rootFiles);
    render(<FileTree {...defaultProps} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
      expect(screen.getByText('README.md')).toBeTruthy();
      expect(screen.getByText('index.ts')).toBeTruthy();
    });
  });

  it('shows empty state when no files', async () => {
    mockApiFetch.mockResolvedValue({ path: '', items: [] });
    render(<FileTree {...defaultProps} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText('No files in project directory')).toBeTruthy();
    });
  });

  it('calls onSelectFile when a file is clicked', async () => {
    mockApiFetch.mockResolvedValue(rootFiles);
    render(<FileTree {...defaultProps} />);
    await act(async () => {});

    await waitFor(() => screen.getByText('README.md'));
    await act(async () => { fireEvent.click(screen.getByText('README.md')); });
    expect(defaultProps.onSelectFile).toHaveBeenCalledWith('README.md');
  });

  it('expands directory on click and fetches children', async () => {
    mockApiFetch.mockResolvedValueOnce(rootFiles);
    render(<FileTree {...defaultProps} />);
    await act(async () => {});

    await waitFor(() => screen.getByText('src'));

    mockApiFetch.mockResolvedValueOnce(srcFiles);
    await act(async () => { fireEvent.click(screen.getByText('src')); });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/proj-1/files?path=src'),
      );
      expect(screen.getByText('main.py')).toBeTruthy();
    });
  });

  it('toggles directory collapse on second click', async () => {
    mockApiFetch.mockResolvedValueOnce(rootFiles);
    render(<FileTree {...defaultProps} />);
    await act(async () => {});
    await waitFor(() => screen.getByText('src'));

    mockApiFetch.mockResolvedValueOnce(srcFiles);
    await act(async () => { fireEvent.click(screen.getByText('src')); });
    await waitFor(() => screen.getByText('main.py'));

    // Collapse
    await act(async () => { fireEvent.click(screen.getByText('src')); });
    expect(screen.queryByText('main.py')).toBeNull();
  });

  it('highlights selected file', async () => {
    mockApiFetch.mockResolvedValue(rootFiles);
    render(<FileTree {...defaultProps} selectedPath="README.md" />);
    await act(async () => {});

    await waitFor(() => {
      const btn = screen.getByText('README.md').closest('button')!;
      expect(btn.className).toContain('text-accent');
    });
  });

  it('does not call onSelectFile when directory is clicked', async () => {
    mockApiFetch.mockResolvedValueOnce(rootFiles);
    mockApiFetch.mockResolvedValueOnce(srcFiles);
    render(<FileTree {...defaultProps} />);
    await act(async () => {});
    await waitFor(() => screen.getByText('src'));

    await act(async () => { fireEvent.click(screen.getByText('src')); });
    expect(defaultProps.onSelectFile).not.toHaveBeenCalled();
  });

  it('fetches root directory on mount using projectId', async () => {
    mockApiFetch.mockResolvedValue(rootFiles);
    render(<FileTree {...defaultProps} />);
    await act(async () => {});

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/projects/proj-1/files?path='),
      );
    });
  });
});
