// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockSetProjectOversight = vi.fn();
const mockClearProjectOversight = vi.fn();

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: vi.fn((sel: any) =>
    sel({
      oversightLevel: 'balanced',
      projectOverrides: {},
      setProjectOversight: mockSetProjectOversight,
      clearProjectOversight: mockClearProjectOversight,
    }),
  ),
}));

import { ProjectOversightPicker } from '../ProjectOversightPicker';

describe('ProjectOversightPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders toggle button showing effective level', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    const toggle = screen.getByTestId('project-oversight-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent(/balanced/i);
  });

  it('shows inherited indicator when no project override', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    // The arrow-up ↑ indicator for "inherited from global"
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('opens picker popover on click', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    expect(screen.queryByTestId('project-oversight-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    expect(screen.getByTestId('project-oversight-picker')).toBeInTheDocument();
  });

  it('renders all three oversight levels', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    expect(screen.getByTestId('project-oversight-supervised')).toBeInTheDocument();
    expect(screen.getByTestId('project-oversight-balanced')).toBeInTheDocument();
    expect(screen.getByTestId('project-oversight-autonomous')).toBeInTheDocument();
  });

  it('calls setProjectOversight and closes popover on level select', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    fireEvent.click(screen.getByTestId('project-oversight-autonomous'));
    expect(mockSetProjectOversight).toHaveBeenCalledWith('proj-1', 'autonomous');
    expect(screen.queryByTestId('project-oversight-picker')).not.toBeInTheDocument();
  });

  it('shows clear button when project has an override', async () => {
    const settingsMod = await import('../../../stores/settingsStore');
    vi.mocked(settingsMod.useSettingsStore).mockImplementation((sel: any) =>
      sel({
        oversightLevel: 'balanced',
        projectOverrides: { 'proj-1': 'supervised' },
        setProjectOversight: mockSetProjectOversight,
        clearProjectOversight: mockClearProjectOversight,
      }),
    );

    render(<ProjectOversightPicker projectId="proj-1" />);
    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    const clearBtn = screen.getByTestId('project-oversight-clear');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(mockClearProjectOversight).toHaveBeenCalledWith('proj-1');
  });

  it('does not show clear button when using global default', async () => {
    // Restore the default mock (no project override)
    const settingsMod = await import('../../../stores/settingsStore');
    vi.mocked(settingsMod.useSettingsStore).mockImplementation((sel: any) =>
      sel({
        oversightLevel: 'balanced',
        projectOverrides: {},
        setProjectOversight: mockSetProjectOversight,
        clearProjectOversight: mockClearProjectOversight,
      }),
    );

    render(<ProjectOversightPicker projectId="proj-1" />);
    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    expect(screen.queryByTestId('project-oversight-clear')).not.toBeInTheDocument();
  });
});
