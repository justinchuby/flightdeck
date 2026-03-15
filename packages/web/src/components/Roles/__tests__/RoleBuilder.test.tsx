import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoleBuilder } from '../RoleBuilder';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../RolePreview', () => ({
  RolePreview: ({ name, icon, model }: { name: string; icon: string; model: string }) => (
    <div data-testid="role-preview">{icon} {name} ({model})</div>
  ),
}));

describe('RoleBuilder', () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({});
  });

  it('renders create mode by default', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByText(/Create Custom Role/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Role name')).toHaveValue('');
    expect(screen.getByPlaceholderText('Description')).toHaveValue('');
    expect(screen.getByPlaceholderText('System prompt...')).toHaveValue('');
  });

  it('renders edit mode with initial data', () => {
    render(
      <RoleBuilder
        initial={{ id: 'r1', name: 'Tester', description: 'A tester', icon: '🧪', color: '#ef4444', model: 'opus', systemPrompt: 'You test code.' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Edit Role/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Role name')).toHaveValue('Tester');
    expect(screen.getByPlaceholderText('Description')).toHaveValue('A tester');
    expect(screen.getByPlaceholderText('System prompt...')).toHaveValue('You test code.');
  });

  it('shows word count and token estimate', () => {
    render(
      <RoleBuilder
        initial={{ name: 'X', description: '', icon: '🤖', color: '#000', model: 'sonnet', systemPrompt: 'one two three four five' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    // 5 words * 1.4 = 7 tokens
    expect(screen.getByText('5 words (~7 tokens)')).toBeInTheDocument();
  });

  it('updates name and description fields', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'My Role' } });
    expect(screen.getByPlaceholderText('Role name')).toHaveValue('My Role');
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Desc' } });
    expect(screen.getByPlaceholderText('Description')).toHaveValue('Desc');
  });

  it('disables Save and Test when name is empty', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByText('Save Role →')).toBeDisabled();
    expect(screen.getByText('Test Role ▸')).toBeDisabled();
  });

  it('enables Save and Test when name is provided', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'My Role' } });
    expect(screen.getByText('Save Role →')).not.toBeDisabled();
    expect(screen.getByText('Test Role ▸')).not.toBeDisabled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    // There are two Cancel buttons (header × and footer Cancel); click the text one
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when ✕ close button is clicked', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('saves a new role via POST', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'NewRole' } });
    fireEvent.click(screen.getByText('Save Role →'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/roles', expect.objectContaining({ method: 'POST' }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'NewRole' }));
    });
  });

  it('saves an existing role via PUT', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    render(
      <RoleBuilder
        initial={{ id: 'r1', name: 'Old', description: '', icon: '🤖', color: '#000', model: 'sonnet', systemPrompt: '' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Save Role →'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/roles/r1', expect.objectContaining({ method: 'PUT' }));
      expect(onSave).toHaveBeenCalled();
    });
  });

  it('handles save failure gracefully (button resets)', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('fail'));
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save Role →'));
    // While saving
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Save Role →')).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('tests a role and shows the result', async () => {
    mockApiFetch.mockResolvedValueOnce({ response: 'Hello! I am a test role.' });
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByText('Test Role ▸'));
    expect(screen.getByText('Testing…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Hello! I am a test role.')).toBeInTheDocument();
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/roles/test', expect.objectContaining({ method: 'POST' }));
  });

  it('shows failure message when test fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network'));
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'T' } });
    fireEvent.click(screen.getByText('Test Role ▸'));
    await waitFor(() => {
      expect(screen.getByText('Test failed.')).toBeInTheDocument();
    });
  });

  it('shows Delete button in edit mode with onDelete', () => {
    render(
      <RoleBuilder
        initial={{ id: 'r1', name: 'X', description: '', icon: '🤖', color: '#000', model: 'sonnet', systemPrompt: '' }}
        onSave={onSave}
        onCancel={onCancel}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('does not show Delete button in create mode', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} onDelete={onDelete} />);
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('deletes a role', async () => {
    mockApiFetch.mockResolvedValueOnce({});
    render(
      <RoleBuilder
        initial={{ id: 'r1', name: 'X', description: '', icon: '🤖', color: '#000', model: 'sonnet', systemPrompt: '' }}
        onSave={onSave}
        onCancel={onCancel}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/roles/r1', { method: 'DELETE' });
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('selects a model', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    // Sonnet is default (selected)
    expect(screen.getByText(/◉ Sonnet/)).toBeInTheDocument();
    expect(screen.getByText(/○ Opus/)).toBeInTheDocument();
    // Switch to Opus
    fireEvent.click(screen.getByText(/○ Opus/));
    expect(screen.getByText(/◉ Opus/)).toBeInTheDocument();
  });

  it('selects a template to populate system prompt', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    const select = screen.getByDisplayValue('Start from a template...');
    fireEvent.change(select, { target: { value: 'security' } });
    const promptValue = screen.getByPlaceholderText('System prompt...') as HTMLTextAreaElement;
    expect(promptValue.value).toContain('security auditor');
  });

  it('toggles icon picker and selects an icon', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    // Default icon is 🤖; the icon button shows it
    const iconBtn = screen.getByText('🤖');
    fireEvent.click(iconBtn);
    // Icon picker should open (radiogroup)
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    // Select a different icon
    fireEvent.click(screen.getByLabelText('🔒'));
    // Picker should close
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('selects a color', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    const colorBtn = screen.getByLabelText('Color #ef4444');
    fireEvent.click(colorBtn);
    // The preview should reflect the change
    expect(screen.getByTestId('role-preview')).toBeInTheDocument();
  });

  it('renders RolePreview with current state', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    // No name => default "New Role"
    expect(screen.getByTestId('role-preview')).toHaveTextContent('New Role');
    fireEvent.change(screen.getByPlaceholderText('Role name'), { target: { value: 'Custom' } });
    expect(screen.getByTestId('role-preview')).toHaveTextContent('Custom');
  });
});
