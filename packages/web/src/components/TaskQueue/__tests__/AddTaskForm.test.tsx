// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { AddTaskForm } from '../AddTaskForm';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockResolvedValue({});
});
afterEach(cleanup);

describe('AddTaskForm', () => {
  it('renders title, role, and description fields', async () => {
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={vi.fn()} />); });
    expect(screen.getByLabelText('Task title')).toBeDefined();
    expect(screen.getByLabelText('Task role')).toBeDefined();
    expect(screen.getByLabelText('Task description')).toBeDefined();
  });

  it('renders submit and cancel buttons', async () => {
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={vi.fn()} />); });
    expect(screen.getByText('Add Task')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('disables submit when title or role empty', async () => {
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={vi.fn()} />); });
    const submitBtn = screen.getByText('Add Task') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('enables submit when title and role filled', async () => {
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={vi.fn()} />); });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Fix bug' } });
    fireEvent.change(screen.getByLabelText('Task role'), { target: { value: 'developer' } });
    const submitBtn = screen.getByText('Add Task') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('calls apiFetch on submit and triggers callbacks', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={onCreated} onClose={onClose} />); });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Fix bug' } });
    fireEvent.change(screen.getByLabelText('Task role'), { target: { value: 'developer' } });
    fireEvent.submit(screen.getByTestId('add-task-form'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/p1/tasks', expect.objectContaining({ method: 'POST' }));
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={vi.fn()} />); });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Fix' } });
    fireEvent.change(screen.getByLabelText('Task role'), { target: { value: 'dev' } });
    fireEvent.submit(screen.getByTestId('add-task-form'));
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeDefined();
    });
  });

  it('calls onClose when Cancel clicked', async () => {
    const onClose = vi.fn();
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={onClose} />); });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape pressed', async () => {
    const onClose = vi.fn();
    await act(async () => { render(<AddTaskForm projectId="p1" onCreated={vi.fn()} onClose={onClose} />); });
    fireEvent.keyDown(screen.getByTestId('add-task-form'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
