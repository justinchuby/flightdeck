import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumb } from '../Breadcrumb';
import { useNavigationStore } from '../../../stores/navigationStore';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('Breadcrumb', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useNavigationStore.setState({
      currentProjectId: null,
      currentProjectName: null,
      activeTab: null,
      history: [],
      forward: [],
      badges: {},
    });
  });

  it('renders nothing when on home page (no project)', () => {
    const { container } = render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-testid="breadcrumb"]')).toBeNull();
  });

  it('renders Home > Project when on project overview', () => {
    useNavigationStore.setState({
      currentProjectId: 'proj-abc',
      currentProjectName: 'My App',
      activeTab: 'overview',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('breadcrumb')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    // On overview, project name is the last segment (current page)
    expect(screen.getByText('My App')).toBeTruthy();
  });

  it('renders Home > Project > Tab for non-overview tabs', () => {
    useNavigationStore.setState({
      currentProjectId: 'proj-abc',
      currentProjectName: 'My App',
      activeTab: 'tasks',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('My App')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  it('uses truncated ID when project name is missing', () => {
    useNavigationStore.setState({
      currentProjectId: 'abcdef1234567890',
      currentProjectName: null,
      activeTab: 'session',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    expect(screen.getByText('abcdef12')).toBeTruthy();
  });

  it('navigates to home on Home click', () => {
    useNavigationStore.setState({
      currentProjectId: 'proj-1',
      currentProjectName: 'Test',
      activeTab: 'session',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Home'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('navigates to project overview on project name click', () => {
    useNavigationStore.setState({
      currentProjectId: 'proj-1',
      currentProjectName: 'Test',
      activeTab: 'tasks',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Test'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/overview');
  });

  it('last segment is not clickable (aria-current=page)', () => {
    useNavigationStore.setState({
      currentProjectId: 'proj-1',
      currentProjectName: 'Test',
      activeTab: 'agents',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    const agentsEl = screen.getByText('Agents');
    expect(agentsEl.getAttribute('aria-current')).toBe('page');
    expect(agentsEl.tagName).toBe('SPAN'); // not a button
  });

  it('has accessible nav landmark', () => {
    useNavigationStore.setState({
      currentProjectId: 'proj-1',
      currentProjectName: 'Test',
      activeTab: 'overview',
    });
    render(
      <MemoryRouter>
        <Breadcrumb />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Breadcrumb')).toBeTruthy();
  });
});
