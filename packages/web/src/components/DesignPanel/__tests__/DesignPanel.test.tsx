import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DesignPanel } from '../DesignPanel';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => 'test-project',
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../ui/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-testid="md-render">{text}</div>,
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <DesignPanel />
    </MemoryRouter>,
  );
}

describe('DesignPanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    // Default: root dir returns files
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/files')) {
        return Promise.resolve({
          path: '.',
          items: [
            { name: 'docs', path: 'docs', type: 'directory' },
            { name: 'README.md', path: 'README.md', type: 'file', ext: 'md' },
            { name: 'index.ts', path: 'index.ts', type: 'file', ext: 'ts' },
          ],
        });
      }
      if (url.includes('/file-contents')) {
        return Promise.resolve({
          path: 'README.md',
          content: '# Hello World\n\nThis is a test.',
          size: 34,
          ext: 'md',
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('renders empty state initially', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('design-panel')).toBeTruthy();
    });
    expect(screen.getByTestId('design-empty')).toBeTruthy();
  });

  it('shows file tree with entries from API', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });
    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText('index.ts')).toBeTruthy();
  });

  it('loads and renders markdown file on click', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('README.md'));
    await waitFor(() => {
      expect(screen.getByTestId('md-render')).toBeTruthy();
    });
    expect(screen.getByTestId('md-render').textContent).toContain('# Hello World');
  });

  it('loads and renders code file as pre block', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/files')) {
        return Promise.resolve({
          path: '.',
          items: [
            { name: 'index.ts', path: 'index.ts', type: 'file', ext: 'ts' },
          ],
        });
      }
      if (url.includes('/file-contents')) {
        return Promise.resolve({
          path: 'index.ts',
          content: 'export const x = 1;',
          size: 20,
          ext: 'ts',
        });
      }
      return Promise.reject(new Error('Unknown'));
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('index.ts'));
    await waitFor(() => {
      expect(screen.getByTestId('code-preview')).toBeTruthy();
    });
    expect(screen.getByTestId('code-preview').textContent).toContain('export const x = 1;');
  });

  it('shows error when file load fails', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/files')) {
        return Promise.resolve({
          path: '.',
          items: [{ name: 'bad.md', path: 'bad.md', type: 'file', ext: 'md' }],
        });
      }
      if (url.includes('/file-contents')) {
        return Promise.reject(new Error('File not found'));
      }
      return Promise.reject(new Error('Unknown'));
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('bad.md')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('bad.md'));
    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeTruthy();
    });
  });

  it('can toggle sidebar closed and open', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Files')).toBeTruthy();
    });

    // Close sidebar
    await act(async () => { fireEvent.click(screen.getByLabelText('Close sidebar')); });
    expect(screen.queryByText('Files')).toBeNull();

    // Re-open sidebar
    await act(async () => { fireEvent.click(screen.getByLabelText('Open sidebar')); });
    expect(screen.getByText('Files')).toBeTruthy();
  });
});
