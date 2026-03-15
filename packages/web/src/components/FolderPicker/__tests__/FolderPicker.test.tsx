import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FolderPicker } from '../FolderPicker';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const defaultBrowseResult = {
  current: '/home/user/projects',
  parent: '/home/user',
  folders: [
    { name: 'src', path: '/home/user/projects/src' },
    { name: 'docs', path: '/home/user/projects/docs' },
  ],
};

describe('FolderPicker', () => {
  const onChange = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(defaultBrowseResult);
  });

  it('renders and loads folders on mount', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    expect(screen.getByText('Select Directory')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('docs')).toBeInTheDocument();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/browse?path=%2Fhome%2Fuser%2Fprojects');
  });

  it('calls browse without path when value is empty', async () => {
    render(<FolderPicker value="" onChange={onChange} onClose={onClose} />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/browse');
    });
  });

  it('shows current path', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('/home/user/projects')).toBeInTheDocument();
    });
  });

  it('navigates to a subfolder when clicked', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());

    mockApiFetch.mockResolvedValueOnce({
      current: '/home/user/projects/src',
      parent: '/home/user/projects',
      folders: [{ name: 'components', path: '/home/user/projects/src/components' }],
    });
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/browse?path=%2Fhome%2Fuser%2Fprojects%2Fsrc');
    });
  });

  it('shows "Go to parent directory" button and navigates up', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    await waitFor(() => expect(screen.getByLabelText('Go to parent directory')).toBeInTheDocument());
    mockApiFetch.mockResolvedValueOnce({
      current: '/home/user',
      parent: '/home',
      folders: [{ name: 'projects', path: '/home/user/projects' }],
    });
    fireEvent.click(screen.getByLabelText('Go to parent directory'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/browse?path=%2Fhome%2Fuser');
    });
  });

  it('hides parent button when parent equals current', async () => {
    mockApiFetch.mockResolvedValue({
      current: '/',
      parent: '/',
      folders: [],
    });
    render(<FolderPicker value="/" onChange={onChange} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.queryByLabelText('Go to parent directory')).not.toBeInTheDocument();
    });
  });

  it('calls onChange and onClose when Select is clicked', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Select "/));
    expect(onChange).toHaveBeenCalledWith('/home/user/projects');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close button (×) is clicked', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close folder picker'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', async () => {
    render(<FolderPicker value="/home/user/projects" onChange={onChange} onClose={onClose} />);
    // The backdrop is the outermost div with the fixed class
    const backdrop = screen.getByText('Select Directory').closest('.fixed')!;
    // mouseDown on backdrop itself (target === currentTarget)
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when API returns error', async () => {
    mockApiFetch.mockResolvedValue({
      current: '/home/user',
      parent: '/home',
      folders: [],
      error: 'Permission denied',
    });
    render(<FolderPicker value="/home/user" onChange={onChange} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });
  });

  it('shows fallback error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<FolderPicker value="/some/path" onChange={onChange} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Failed to browse directory')).toBeInTheDocument();
    });
  });

  it('shows empty state when no subdirectories exist', async () => {
    mockApiFetch.mockResolvedValue({
      current: '/home/user/empty',
      parent: '/home/user',
      folders: [],
    });
    render(<FolderPicker value="/home/user/empty" onChange={onChange} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('No subdirectories')).toBeInTheDocument();
    });
  });
});
