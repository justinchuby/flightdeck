import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickStart } from '../QuickStart';

describe('QuickStart', () => {
  const onSelectTemplate = vi.fn();
  const onStartFromScratch = vi.fn();
  const onBrowseProjects = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderComponent() {
    return render(
      <QuickStart
        onSelectTemplate={onSelectTemplate}
        onStartFromScratch={onStartFromScratch}
        onBrowseProjects={onBrowseProjects}
      />,
    );
  }

  it('renders the welcome heading', () => {
    renderComponent();
    expect(screen.getByText(/Welcome to Flightdeck/)).toBeInTheDocument();
  });

  it('renders all five templates', () => {
    renderComponent();
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.getByText('Bug Fix')).toBeInTheDocument();
    expect(screen.getByText('Quick Fix')).toBeInTheDocument();
    expect(screen.getByText('Docs Blitz')).toBeInTheDocument();
    expect(screen.getByText('Full Build')).toBeInTheDocument();
  });

  it('shows the recommended badge on Quick Fix', () => {
    renderComponent();
    expect(screen.getByText('✨ Recommended')).toBeInTheDocument();
  });

  it('displays role counts for each template', () => {
    renderComponent();
    // Quick Fix has "1 Lead" and "1 Developer"
    expect(screen.getAllByText('1 Lead').length).toBeGreaterThanOrEqual(1);
    // Code Review has "2 Developers"
    expect(screen.getAllByText('2 Developers').length).toBeGreaterThanOrEqual(1);
  });

  it('displays time ranges', () => {
    renderComponent();
    expect(screen.getByText('30–60 min')).toBeInTheDocument();
    expect(screen.getByText('15–30 min')).toBeInTheDocument();
  });

  it('calls onSelectTemplate when a template Start button is clicked', () => {
    renderComponent();
    const startButtons = screen.getAllByRole('button', { name: /Start →/ });
    fireEvent.click(startButtons[0]);
    expect(onSelectTemplate).toHaveBeenCalledWith('code-review');
  });

  it('shows "Launching…" on the clicked template and disables all buttons', () => {
    renderComponent();
    const startButtons = screen.getAllByRole('button', { name: /Start →/ });
    fireEvent.click(startButtons[0]);

    expect(screen.getByText('Launching…')).toBeInTheDocument();
    // All template Start/Launching buttons should be disabled
    const templateButtons = screen.getAllByRole('button', { name: /Start →|Launching/ });
    for (const btn of templateButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it('calls onStartFromScratch when "Start from scratch" is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText(/Start from scratch/));
    expect(onStartFromScratch).toHaveBeenCalledOnce();
  });

  it('calls onBrowseProjects when "Browse projects" is clicked', () => {
    renderComponent();
    fireEvent.click(screen.getByText(/Browse projects/));
    expect(onBrowseProjects).toHaveBeenCalledOnce();
  });
});
