import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportProjectDialog } from '../ImportProjectDialog';

function renderDialog(overrides = {}) {
  const props = {
    importPath: '',
    onPathChange: vi.fn(),
    onImport: vi.fn(),
    onClose: vi.fn(),
    loading: false,
    ...overrides,
  };
  render(<ImportProjectDialog {...props} />);
  return props;
}

describe('ImportProjectDialog', () => {
  it('renders title and description', () => {
    renderDialog();
    expect(screen.getByText('Import Project')).toBeTruthy();
    expect(screen.getByText(/\.flightdeck\//)).toBeTruthy();
  });

  it('calls onPathChange when typing in input', () => {
    const props = renderDialog();
    const input = screen.getByPlaceholderText('/path/to/your/project');
    fireEvent.change(input, { target: { value: '/home/user/proj' } });
    expect(props.onPathChange).toHaveBeenCalledWith('/home/user/proj');
  });

  it('calls onImport on Enter when path is not empty', () => {
    const props = renderDialog({ importPath: '/some/path' });
    const input = screen.getByPlaceholderText('/path/to/your/project');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onImport).toHaveBeenCalledOnce();
  });

  it('does not call onImport on Enter when path is empty', () => {
    const props = renderDialog({ importPath: '' });
    const input = screen.getByPlaceholderText('/path/to/your/project');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onImport).not.toHaveBeenCalled();
  });

  it('disables Import button when path is empty', () => {
    renderDialog({ importPath: '' });
    const importBtn = screen.getByText('Import').closest('button')!;
    expect(importBtn.disabled).toBe(true);
  });

  it('disables Import button when loading', () => {
    renderDialog({ importPath: '/some/path', loading: true });
    const importBtn = screen.getByText('Import').closest('button')!;
    expect(importBtn.disabled).toBe(true);
  });

  it('calls onClose when Cancel is clicked', () => {
    const props = renderDialog();
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const props = renderDialog();
    // The backdrop is the outermost div
    const backdrop = screen.getByText('Import Project').closest('.fixed')!;
    fireEvent.click(backdrop);
    expect(props.onClose).toHaveBeenCalled();
  });
});
