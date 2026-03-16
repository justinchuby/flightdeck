// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ filteredModels: ['gpt-4', 'claude-3'] }),
  deriveModelName: (m: string) => m.toUpperCase(),
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../ModelConfigPanel', () => ({
  ModelConfigPanel: () => <div data-testid="model-config-panel" />,
}));
vi.mock('../../FolderPicker/FolderPicker', () => ({
  FolderPicker: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="folder-picker"><button onClick={onClose}>close-picker</button></div>
  ),
}));

import { useLeadStore } from '../../../stores/leadStore';
import { NewProjectModal } from '../NewProjectModal';

function renderModal(props = {}) {
  const onClose = vi.fn();
  const result = render(
    <MemoryRouter>
      <NewProjectModal onClose={onClose} {...props} />
    </MemoryRouter>,
  );
  return { ...result, onClose };
}

describe('NewProjectModal', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockNavigate.mockClear();
    // Mock /roles endpoint
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/roles') return Promise.resolve([
        { id: 'developer', name: 'Developer', icon: '\ud83d\udcbb', description: 'Writes code', model: '' },
        { id: 'lead', name: 'Lead', icon: '\ud83d\udc51', description: 'Leads', model: '' },
      ]);
      return Promise.resolve({ id: 'lead-1', projectId: 'proj-1' });
    });
  });

  it('renders the form', async () => {
    renderModal();
    expect(screen.getByText('New Project')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('My Feature')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Describe what you want/)).toBeInTheDocument();
    await act(async () => {});
  });

  it('validates project name is required', async () => {
    renderModal();
    // First blur the name field to trigger touched state
    const nameInput = screen.getByPlaceholderText('My Feature');
    await act(async () => {
      fireEvent.focus(nameInput);
      fireEvent.blur(nameInput);
    });
    // Then click create
    await act(async () => {
      fireEvent.click(screen.getByText('Create Project'));
    });
    await waitFor(() => {
      expect(screen.getByText('Project name is required')).toBeInTheDocument();
    });
  });

  it('creates a project successfully', async () => {
    const { onClose } = renderModal();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('My Feature'), { target: { value: 'Test Project' } });
      fireEvent.click(screen.getByText('Create Project'));
    });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/lead/start', expect.objectContaining({
        method: 'POST',
      }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('navigates to project on success', async () => {
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('My Feature'), { target: { value: 'Test Project' } });
      fireEvent.click(screen.getByText('Create Project'));
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });
  });

  it('shows error on API failure', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/roles') return Promise.resolve([]);
      return Promise.reject(new Error('Server error'));
    });
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('My Feature'), { target: { value: 'Test' } });
      fireEvent.click(screen.getByText('Create Project'));
    });
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('shows loading state during creation', async () => {
    let resolveCreate: (v: unknown) => void;
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/roles') return Promise.resolve([]);
      return new Promise((r) => { resolveCreate = r; });
    });
    renderModal();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('My Feature'), { target: { value: 'Test' } });
      fireEvent.click(screen.getByText('Create Project'));
    });
    await waitFor(() => {
      expect(screen.getByText('Starting...')).toBeInTheDocument();
    });
    await act(async () => resolveCreate!({ id: 'lead-1', projectId: 'proj-1' }));
  });

  it('closes on Cancel', async () => {
    const { onClose } = renderModal();
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const { onClose, container } = renderModal();
    const backdrop = container.querySelector('.fixed.inset-0') as HTMLElement;
    await act(async () => {
      if (backdrop) fireEvent.mouseDown(backdrop);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows available roles for crew selection', async () => {
    renderModal();
    await waitFor(() => {
      // Lead role should be filtered out
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });
  });

  it('toggles role selection', async () => {
    renderModal();
    await waitFor(() => screen.getByText('Developer'));
    const devBtn = screen.getByText('Developer').closest('button');
    if (devBtn) {
      await act(async () => {
        fireEvent.click(devBtn);
      });
      // Should be visually selected
      expect(devBtn.className).toContain('yellow');
    }
  });

  it('opens folder picker', async () => {
    renderModal();
    const browseBtn = screen.getByTitle('Browse folders');
    await act(async () => {
      fireEvent.click(browseBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('folder-picker')).toBeInTheDocument();
    });
  });

  it('toggles model config panel', async () => {
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByText('Model Configuration'));
    });
    expect(screen.getByTestId('model-config-panel')).toBeInTheDocument();
  });
});
