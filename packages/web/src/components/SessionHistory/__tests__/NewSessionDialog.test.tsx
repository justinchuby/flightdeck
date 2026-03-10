import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NewSessionDialog } from '../NewSessionDialog';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const MOCK_ROLES = [
  { id: 'lead', name: 'Lead', icon: '👑', description: 'Project lead', model: 'claude-opus-4.6' },
  { id: 'developer', name: 'Developer', icon: '💻', description: 'Writes code', model: 'claude-opus-4.6' },
  { id: 'architect', name: 'Architect', icon: '🏗️', description: 'System design', model: 'claude-opus-4.6' },
  { id: 'code-reviewer', name: 'Code Reviewer', icon: '📖', description: 'Reviews code', model: 'gemini-3-pro-preview' },
];

const MOCK_MODELS_RESPONSE = {
  models: ['claude-opus-4.6', 'claude-sonnet-4.6', 'claude-haiku-4.5', 'gemini-3-pro-preview'],
  defaults: { lead: ['claude-opus-4.6'], developer: ['claude-opus-4.6'] },
};

describe('NewSessionDialog', () => {
  const onClose = vi.fn();
  const onStarted = vi.fn();

  /** Default mock that handles /roles and /models; override resume path as needed */
  function mockDefaultEndpoints(resumeHandler?: (path: string) => Promise<any>) {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/roles') return Promise.resolve(MOCK_ROLES);
      if (path === '/models') return Promise.resolve(MOCK_MODELS_RESPONSE);
      if (resumeHandler) return resumeHandler(path);
      return Promise.resolve({});
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultEndpoints();
  });

  function renderDialog() {
    return render(
      <MemoryRouter>
        <NewSessionDialog projectId="proj-1" onClose={onClose} onStarted={onStarted} />
      </MemoryRouter>,
    );
  }

  it('renders the dialog with header and controls', async () => {
    renderDialog();
    expect(screen.getByText('New Session')).toBeInTheDocument();
    expect(screen.getByTestId('new-session-task')).toBeInTheDocument();
    expect(screen.getByTestId('new-session-model')).toBeInTheDocument();
    expect(screen.getByTestId('start-session-btn')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('fetches models from /models API and populates dropdown', async () => {
    renderDialog();
    await waitFor(() => {
      const select = screen.getByTestId('new-session-model') as HTMLSelectElement;
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toContain('');
      expect(options).toContain('claude-opus-4.6');
      expect(options).toContain('claude-sonnet-4.6');
      expect(options).toContain('gemini-3-pro-preview');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/models');
  });

  it('fetches and displays roles (excluding lead)', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByTestId('role-developer')).toBeInTheDocument();
      expect(screen.getByTestId('role-architect')).toBeInTheDocument();
      expect(screen.getByTestId('role-code-reviewer')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('role-lead')).not.toBeInTheDocument();
  });

  it('toggles role selection on click', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('role-developer')).toBeInTheDocument());

    const devBtn = screen.getByTestId('role-developer');
    expect(devBtn).toHaveClass('bg-th-bg');

    fireEvent.click(devBtn);
    expect(devBtn).toHaveClass('bg-accent/20');

    fireEvent.click(devBtn);
    expect(devBtn).toHaveClass('bg-th-bg');
  });

  it('calls resume endpoint with freshStart on start', async () => {
    mockDefaultEndpoints(() => Promise.resolve({ id: 'lead-1' }));
    renderDialog();

    fireEvent.click(screen.getByTestId('start-session-btn'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/projects/proj-1/resume',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"freshStart":true'),
        }),
      );
    });
    expect(onStarted).toHaveBeenCalled();
  });

  it('includes task in the request body', async () => {
    mockDefaultEndpoints(() => Promise.resolve({ id: 'lead-1' }));
    renderDialog();

    fireEvent.change(screen.getByTestId('new-session-task'), {
      target: { value: 'Fix all bugs' },
    });
    fireEvent.click(screen.getByTestId('start-session-btn'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        (c: any[]) => c[0] === '/projects/proj-1/resume',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.task).toContain('Fix all bugs');
      expect(body.freshStart).toBe(true);
    });
  });

  it('includes selected roles as team hint in task', async () => {
    mockDefaultEndpoints(() => Promise.resolve({ id: 'lead-1' }));
    renderDialog();

    await waitFor(() => expect(screen.getByTestId('role-developer')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('role-developer'));
    fireEvent.click(screen.getByTestId('role-architect'));

    fireEvent.click(screen.getByTestId('start-session-btn'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        (c: any[]) => c[0] === '/projects/proj-1/resume',
      );
      const body = JSON.parse(call![1].body);
      expect(body.task).toContain('[Initial Crew]');
      expect(body.task).toContain('developer');
      expect(body.task).toContain('architect');
    });
  });

  it('sends selected lead model', async () => {
    mockDefaultEndpoints(() => Promise.resolve({ id: 'lead-1' }));
    renderDialog();

    // Wait for models to load into the dropdown
    await waitFor(() => {
      const select = screen.getByTestId('new-session-model') as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByTestId('new-session-model'), {
      target: { value: 'claude-sonnet-4.6' },
    });
    fireEvent.click(screen.getByTestId('start-session-btn'));

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(
        (c: any[]) => c[0] === '/projects/proj-1/resume',
      );
      const body = JSON.parse(call![1].body);
      expect(body.model).toBe('claude-sonnet-4.6');
    });
  });

  it('shows error on API failure', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/roles') return Promise.resolve(MOCK_ROLES);
      if (path === '/models') return Promise.resolve(MOCK_MODELS_RESPONSE);
      return Promise.reject(new Error('Server down'));
    });
    renderDialog();

    fireEvent.click(screen.getByTestId('start-session-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('new-session-error')).toHaveTextContent('Server down');
    });
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('closes on Cancel click', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    renderDialog();
    const backdrop = screen.getByTestId('new-session-dialog');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('disables start button while starting', async () => {
    let resolveResume: (v: any) => void;
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/roles') return Promise.resolve(MOCK_ROLES);
      if (path === '/models') return Promise.resolve(MOCK_MODELS_RESPONSE);
      return new Promise((r) => { resolveResume = r; });
    });
    renderDialog();

    fireEvent.click(screen.getByTestId('start-session-btn'));
    expect(screen.getByTestId('start-session-btn')).toBeDisabled();
    expect(screen.getByText('Starting…')).toBeInTheDocument();

    resolveResume!({ id: 'lead-1' });
    await waitFor(() => {
      expect(onStarted).toHaveBeenCalled();
    });
  });
});
