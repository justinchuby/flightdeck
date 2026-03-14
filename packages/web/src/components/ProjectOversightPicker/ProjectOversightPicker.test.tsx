import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectOversightPicker } from './ProjectOversightPicker';
import { useSettingsStore } from '../../stores/settingsStore';

describe('ProjectOversightPicker', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      oversightLevel: 'balanced',
      projectOverrides: {},
    });
  });

  it('shows inherited global level with arrow indicator', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    const toggle = screen.getByTestId('project-oversight-toggle');
    expect(toggle).toHaveTextContent('balanced');
    expect(toggle).toHaveTextContent('↑'); // inherited indicator
  });

  it('shows project override without inherited indicator', () => {
    useSettingsStore.setState({ projectOverrides: { 'proj-1': 'autonomous' } });
    render(<ProjectOversightPicker projectId="proj-1" />);
    const toggle = screen.getByTestId('project-oversight-toggle');
    expect(toggle).toHaveTextContent('autonomous');
    expect(toggle.textContent).not.toContain('↑');
  });

  it('opens picker and selects a level', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);

    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    expect(screen.getByTestId('project-oversight-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('project-oversight-supervised'));
    expect(useSettingsStore.getState().projectOverrides['proj-1']).toBe('supervised');
  });

  it('shows clear option when project has override', () => {
    useSettingsStore.setState({ projectOverrides: { 'proj-1': 'supervised' } });
    render(<ProjectOversightPicker projectId="proj-1" />);

    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    const clearBtn = screen.getByTestId('project-oversight-clear');
    expect(clearBtn).toHaveTextContent('Use global default');

    fireEvent.click(clearBtn);
    // After clearing, the override should be gone
    expect(useSettingsStore.getState().projectOverrides['proj-1']).toBeUndefined();
  });

  it('does not show clear option when using global default', () => {
    render(<ProjectOversightPicker projectId="proj-1" />);
    fireEvent.click(screen.getByTestId('project-oversight-toggle'));
    expect(screen.queryByTestId('project-oversight-clear')).not.toBeInTheDocument();
  });
});
