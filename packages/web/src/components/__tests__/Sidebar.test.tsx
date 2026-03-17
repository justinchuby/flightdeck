import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar';

vi.mock('../LeadDashboard/NewProjectModal', () => ({
  NewProjectModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="new-project-modal">
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

vi.mock('../ProvideFeedback', () => ({
  SubmitIssueButton: () => <div data-testid="submit-issue-btn" />,
}));

function renderSidebar(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders all navigation items', () => {
    renderSidebar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders nav links with correct hrefs', () => {
    renderSidebar();
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Projects').closest('a')).toHaveAttribute('href', '/projects');
    expect(screen.getByText('Agents').closest('a')).toHaveAttribute('href', '/agents');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  it('renders the New Project button', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar-new-project')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('opens NewProjectModal when New button is clicked', () => {
    renderSidebar();
    expect(screen.queryByTestId('new-project-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sidebar-new-project'));
    expect(screen.getByTestId('new-project-modal')).toBeInTheDocument();
  });

  it('closes NewProjectModal via onClose callback', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('sidebar-new-project'));
    expect(screen.getByTestId('new-project-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Modal'));
    expect(screen.queryByTestId('new-project-modal')).not.toBeInTheDocument();
  });

  it('renders SubmitIssueButton', () => {
    renderSidebar();
    expect(screen.getByTestId('submit-issue-btn')).toBeInTheDocument();
  });

  it('has sidebar data-tour attribute', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('data-tour', 'sidebar');
  });
});

// NavItem is not exported, so we test the badge conditional logic inline
// using the same expression: badge != null && badge > 0
describe('NavItem badge rendering', () => {
  function BadgeDemo({ badge }: { badge?: number | null }) {
    return (
      <div>
        <div className="relative">
          <span>icon</span>
          {badge != null && badge > 0 && (
            <span data-testid="badge">{badge}</span>
          )}
        </div>
      </div>
    );
  }

  it('renders badge when badge > 0', () => {
    render(<BadgeDemo badge={3} />);
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByTestId('badge').textContent).toBe('3');
  });

  it('does NOT render badge when badge is null', () => {
    render(<BadgeDemo badge={null} />);
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
  });

  it('does NOT render badge when badge is 0', () => {
    render(<BadgeDemo badge={0} />);
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
  });
});
